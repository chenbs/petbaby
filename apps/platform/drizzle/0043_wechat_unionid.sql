-- 2026-10-09：微信账号以 unionid 为唯一标识，openid 只记录。
--
-- unionid 是用户在微信开放平台下的唯一标识，同一开放平台下的小程序、公众号、网站应用一致；
-- openid 只对当前小程序有效，保留它是因为微信支付与虚拟支付必须用当前小程序的 openid。
-- 小程序必须绑定微信开放平台，code2Session 才会返回 unionid；拿不到时登录明确失败，不回落到 openid。
ALTER TABLE users ADD COLUMN IF NOT EXISTS wechat_unionid text;
CREATE UNIQUE INDEX IF NOT EXISTS users_wechat_unionid_key ON users (wechat_unionid);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_wechat_openid_key;
CREATE INDEX IF NOT EXISTS users_wechat_openid_idx ON users (wechat_openid);
