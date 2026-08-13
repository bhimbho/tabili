use crate::db::error::DbError;

const SERVICE: &str = "com.tabili.app";

fn entry(connection_id: &str) -> Result<keyring::Entry, DbError> {
    keyring::Entry::new(SERVICE, connection_id)
        .map_err(|e| DbError::Other(format!("keychain error: {e}")))
}

pub fn save_password(connection_id: &str, password: &str) -> Result<(), DbError> {
    entry(connection_id)?
        .set_password(password)
        .map_err(|e| DbError::Other(format!("keychain error: {e}")))
}

pub fn get_password(connection_id: &str) -> Result<Option<String>, DbError> {
    match entry(connection_id)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(DbError::Other(format!("keychain error: {e}"))),
    }
}

pub fn delete_password(connection_id: &str) -> Result<(), DbError> {
    match entry(connection_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(DbError::Other(format!("keychain error: {e}"))),
    }
}
