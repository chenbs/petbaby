-- Account/password credentials so Web and 测试环境 can log in without WeChat.
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_updated_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS users_account_name_key ON users(lower(account_name)) WHERE account_name IS NOT NULL;
