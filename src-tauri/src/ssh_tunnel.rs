use std::sync::Arc;

use russh::client::{self, Handle};
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg};
use russh::Disconnect;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

use crate::db::error::DbError;

#[derive(Debug, Clone)]
pub struct SshTunnelConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    /// Absolute path to a private key file. When absent and `use_key` is set,
    /// falls back to the standard `~/.ssh/id_ed25519` / `~/.ssh/id_rsa` locations —
    /// mirroring "leave empty to use ~/.ssh/config" from other SSH-capable clients,
    /// minus actual `~/.ssh/config` `Host` block parsing (not implemented).
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub use_key: bool,
}

/// Verifies the server's host key against `~/.ssh/known_hosts`, trusting (and
/// recording) it on first contact since there's no interactive prompt here.
/// A key that later *changes* for a known host is rejected outright — that's
/// the actual MITM-prevention property this buys us, TOFU alone is weaker but
/// standard for GUI SSH clients that can't prompt.
struct TofuHandler {
    host: String,
    port: u16,
}

impl client::Handler for TofuHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        match russh::keys::check_known_hosts(&self.host, self.port, server_public_key) {
            Ok(true) => Ok(true),
            Ok(false) => {
                let _ = russh::keys::known_hosts::learn_known_hosts(
                    &self.host,
                    self.port,
                    server_public_key,
                );
                Ok(true)
            }
            Err(russh::keys::Error::KeyChanged { .. }) => Ok(false),
            // No known_hosts file / no home dir / parse issue — don't block connecting
            // over a best-effort check that isn't available in this environment.
            Err(_) => Ok(true),
        }
    }
}

/// A live local port forward: connections to `127.0.0.1:{local_port}` are
/// tunneled to the remote host/port through the SSH server. Dropping this
/// tears the tunnel down.
pub struct SshTunnel {
    pub local_port: u16,
    handle: Arc<Handle<TofuHandler>>,
    accept_task: JoinHandle<()>,
}

impl SshTunnel {
    pub async fn close(&self) {
        self.accept_task.abort();
        let _ = self.handle.disconnect(Disconnect::ByApplication, "", "en").await;
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        self.accept_task.abort();
    }
}

fn default_key_candidates() -> Vec<std::path::PathBuf> {
    let Some(home) = std::env::home_dir() else { return vec![] };
    let ssh_dir = home.join(".ssh");
    ["id_ed25519", "id_ecdsa", "id_rsa"]
        .into_iter()
        .map(|name| ssh_dir.join(name))
        .collect()
}

async fn authenticate(handle: &mut Handle<TofuHandler>, cfg: &SshTunnelConfig) -> Result<(), DbError> {
    if cfg.use_key {
        let candidates = match &cfg.private_key_path {
            Some(path) => vec![std::path::PathBuf::from(path)],
            None => default_key_candidates(),
        };
        let mut last_err = None;
        for path in &candidates {
            if !path.exists() {
                continue;
            }
            let key = match load_secret_key(path, cfg.private_key_passphrase.as_deref()) {
                Ok(k) => k,
                Err(e) => {
                    last_err = Some(format!("{}: {e}", path.display()));
                    continue;
                }
            };
            let hash_alg = handle.best_supported_rsa_hash().await.ok().flatten().flatten();
            let key_with_alg = PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg);
            let result = handle
                .authenticate_publickey(cfg.username.clone(), key_with_alg)
                .await
                .map_err(|e| DbError::Connection(format!("SSH key auth failed: {e}")))?;
            if result.success() {
                return Ok(());
            }
            last_err = Some("server rejected the key".into());
        }
        return Err(DbError::Connection(format!(
            "SSH key authentication failed{}",
            last_err.map(|e| format!(": {e}")).unwrap_or_default()
        )));
    }

    let Some(password) = &cfg.password else {
        return Err(DbError::Connection("SSH connection requires a password or key".into()));
    };
    let result = handle
        .authenticate_password(cfg.username.clone(), password.clone())
        .await
        .map_err(|e| DbError::Connection(format!("SSH auth failed: {e}")))?;
    if !result.success() {
        return Err(DbError::Connection("SSH authentication rejected".into()));
    }
    Ok(())
}

/// Opens an SSH connection to `cfg.host:cfg.port`, authenticates, then binds an
/// ephemeral local TCP port that forwards each accepted connection to
/// `remote_host:remote_port` via a `direct-tcpip` channel. The returned tunnel
/// must be kept alive for as long as the forwarded database connection is in use.
pub async fn open_tunnel(
    cfg: &SshTunnelConfig,
    remote_host: &str,
    remote_port: u16,
) -> Result<SshTunnel, DbError> {
    let config = Arc::new(client::Config::default());
    let handler = TofuHandler { host: cfg.host.clone(), port: cfg.port };
    let mut handle = client::connect(config, (cfg.host.as_str(), cfg.port), handler)
        .await
        .map_err(|e| DbError::Connection(format!("SSH connect failed: {e}")))?;

    authenticate(&mut handle, cfg).await?;

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| DbError::Connection(format!("failed to bind local tunnel port: {e}")))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| DbError::Connection(format!("failed to read local tunnel port: {e}")))?
        .port();

    let handle = Arc::new(handle);
    let handle_for_accept = handle.clone();
    let remote_host = remote_host.to_string();
    let accept_task = tokio::spawn(async move {
        loop {
            let (mut stream, addr) = match listener.accept().await {
                Ok(v) => v,
                Err(_) => break,
            };
            let handle = handle_for_accept.clone();
            let remote_host = remote_host.clone();
            tokio::spawn(async move {
                let channel = match handle
                    .channel_open_direct_tcpip(
                        remote_host.as_str(),
                        remote_port as u32,
                        addr.ip().to_string(),
                        addr.port() as u32,
                    )
                    .await
                {
                    Ok(c) => c,
                    Err(_) => return,
                };
                let mut ssh_stream = channel.into_stream();
                let _ = tokio::io::copy_bidirectional(&mut stream, &mut ssh_stream).await;
            });
        }
    });

    Ok(SshTunnel { local_port, handle, accept_task })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// No live SSH server is available in this environment, but this still
    /// verifies the connect-failure path returns a normal `DbError` instead of
    /// panicking or hanging — the most likely regression when touching the
    /// handshake/auth plumbing above.
    #[tokio::test]
    async fn connect_failure_is_a_plain_error() {
        let cfg = SshTunnelConfig {
            host: "127.0.0.1".to_string(),
            port: 1, // nothing listens on port 1
            username: "nobody".to_string(),
            password: Some("wrong".to_string()),
            use_key: false,
            private_key_path: None,
            private_key_passphrase: None,
        };
        let result =
            tokio::time::timeout(std::time::Duration::from_secs(5), open_tunnel(&cfg, "db.internal", 5432))
                .await
                .expect("open_tunnel should fail fast, not hang");
        assert!(result.is_err());
    }
}
