use crate::db::error::DbError;

const SERVICE: &str = "com.tabili.app";
/// Separate keychain namespace for SSH credentials (tunnel password / key
/// passphrase), so they never collide with the DB password entry for the
/// same connection id.
const SSH_SERVICE: &str = "com.tabili.app.ssh";
const SSH_KEY_SERVICE: &str = "com.tabili.app.ssh-key";

fn entry_in(service: &str, connection_id: &str) -> Result<keyring::Entry, DbError> {
    keyring::Entry::new(service, connection_id)
        .map_err(|e| DbError::Other(format!("keychain error: {e}")))
}

fn save(service: &str, connection_id: &str, secret: &str) -> Result<(), DbError> {
    entry_in(service, connection_id)?
        .set_password(secret)
        .map_err(|e| DbError::Other(format!("keychain error: {e}")))
}

fn get(service: &str, connection_id: &str) -> Result<Option<String>, DbError> {
    match entry_in(service, connection_id)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(DbError::Other(format!("keychain error: {e}"))),
    }
}

fn delete(service: &str, connection_id: &str) -> Result<(), DbError> {
    match entry_in(service, connection_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(DbError::Other(format!("keychain error: {e}"))),
    }
}

pub fn save_password(connection_id: &str, password: &str) -> Result<(), DbError> {
    save(SERVICE, connection_id, password)
}

pub fn get_password(connection_id: &str) -> Result<Option<String>, DbError> {
    get(SERVICE, connection_id)
}

pub fn delete_password(connection_id: &str) -> Result<(), DbError> {
    delete(SERVICE, connection_id)?;
    delete(SSH_SERVICE, connection_id)?;
    delete(SSH_KEY_SERVICE, connection_id)?;
    Ok(())
}

pub fn save_ssh_password(connection_id: &str, password: &str) -> Result<(), DbError> {
    save(SSH_SERVICE, connection_id, password)
}

pub fn get_ssh_password(connection_id: &str) -> Result<Option<String>, DbError> {
    get(SSH_SERVICE, connection_id)
}

pub fn save_ssh_key_passphrase(connection_id: &str, passphrase: &str) -> Result<(), DbError> {
    save(SSH_KEY_SERVICE, connection_id, passphrase)
}

pub fn get_ssh_key_passphrase(connection_id: &str) -> Result<Option<String>, DbError> {
    get(SSH_KEY_SERVICE, connection_id)
}
