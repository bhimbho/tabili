use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::db::DatabaseDriver;
use crate::ssh_tunnel::SshTunnel;

pub type ConnectionId = String;

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
