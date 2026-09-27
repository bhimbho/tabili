use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::db::DatabaseDriver;
use crate::ssh_tunnel::SshTunnel;

pub type ConnectionId = String;

/// How long a replaced pool stays open so in-flight requests can finish on it.
const RETIRE_GRACE_SECS: u64 = 10;

/// One `Arc<dyn DatabaseDriver>` (one pool) per saved connection, shared across
/// every tab open against it — not one pool per tab. Connections opened over an
/// SSH tunnel also keep their `SshTunnel` here, keyed the same way, so it lives
/// exactly as long as the driver that depends on it.
#[derive(Default)]
pub struct ConnectionRegistry {
    connections: RwLock<HashMap<ConnectionId, Arc<dyn DatabaseDriver>>>,
    tunnels: RwLock<HashMap<ConnectionId, Arc<SshTunnel>>>,
}

impl ConnectionRegistry {
    pub async fn insert(&self, id: ConnectionId, driver: Arc<dyn DatabaseDriver>) {
        self.connections.write().await.insert(id, driver);
    }

    pub async fn get(&self, id: &str) -> Option<Arc<dyn DatabaseDriver>> {
        self.connections.read().await.get(id).cloned()
    }

    pub async fn remove(&self, id: &str) -> Option<Arc<dyn DatabaseDriver>> {
        self.connections.write().await.remove(id)
    }

    /// Puts `driver` in place of whatever was registered for `id`, and retires
    /// the old pool in the background.
    ///
    /// Replacing a live connection — reconnecting, saving an edit, switching
    /// database — used to remove the old entry, close it, then insert the new
    /// one. That left two gaps a query could fall into: between the remove and
    /// the insert nothing was registered at all ("unknown connection"), and any
    /// request that had already taken an `Arc` to the old pool found it shut
    /// under them ("attempted to acquire a connection on a closed pool").
    ///
    /// Swapping first closes the first gap. For the second, the old pool is
    /// closed after a grace period instead of immediately, which lets requests
    /// already in flight finish against the connection they started on. Nothing
    /// new can reach it: the registry no longer hands it out.
    pub async fn replace(&self, id: ConnectionId, driver: Arc<dyn DatabaseDriver>) {
        let previous = {
            let mut connections = self.connections.write().await;
            connections.insert(id, driver)
        };
        let Some(old) = previous else { return };
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(RETIRE_GRACE_SECS)).await;
            let _ = old.close().await;
        });
    }

    pub async fn insert_tunnel(&self, id: ConnectionId, tunnel: Arc<SshTunnel>) {
        self.tunnels.write().await.insert(id, tunnel);
    }

    pub async fn get_tunnel(&self, id: &str) -> Option<Arc<SshTunnel>> {
        self.tunnels.read().await.get(id).cloned()
    }

    /// Removes and closes any tunnel associated with `id`, if one exists.
    pub async fn remove_tunnel(&self, id: &str) {
        if let Some(tunnel) = self.tunnels.write().await.remove(id) {
            tunnel.close().await;
        }
    }
}
