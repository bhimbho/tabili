use serde::Serialize;
use specta::Type;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("connection failed: {0}")]
    Connection(String),
    #[error("query failed: {0}")]
    Query(String),
    #[error("unsupported operation for this driver: {0}")]
    Unsupported(String),
    #[error("table has no primary key, cannot perform row-level edits")]
    NoPrimaryKey,
    #[error("{0}")]
    Other(String),
}

/// Serializable projection of `DbError` sent across the Tauri IPC boundary.
#[derive(Debug, Clone, Serialize, Type)]
pub struct AppError {
    pub kind: String,
    pub message: String,
}

impl From<DbError> for AppError {
    fn from(err: DbError) -> Self {
        let kind = match &err {
            DbError::Connection(_) => "connection",
            DbError::Query(_) => "query",
            DbError::Unsupported(_) => "unsupported",
            DbError::NoPrimaryKey => "no_primary_key",
            DbError::Other(_) => "other",
        }
        .to_string();
        AppError {
            kind,
            message: err.to_string(),
        }
    }
}
