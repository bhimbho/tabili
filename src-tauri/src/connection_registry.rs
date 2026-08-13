use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::db::DatabaseDriver;

pub type ConnectionId = String;

/// One `Arc<dyn DatabaseDriver>` (one pool) per saved connection, shared across
/// every tab open against it — not one pool per tab.
#[derive(Default)]
pub struct ConnectionRegistry {
    connections: RwLock<HashMap<ConnectionId, Arc<dyn DatabaseDriver>>>,
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
}
