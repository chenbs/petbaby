-- 2026-10-25：小程序不绑定微信开放平台，账号唯一标识改回当前小程序的 openid。
--
-- 0043 曾以 unionid 为唯一标识；不绑定开放平台时 code2Session 不返回 unionid，登录会全部失败。
-- wechat_unionid 列保留（历史数据与将来绑定后合并账号用），但不再写入、不再作为身份键。
-- 注销会把 wechat_openid 置 NULL，所以唯一约束不会挡住同一微信注销后重新注册。
DROP INDEX IF EXISTS users_wechat_openid_idx;
CREATE UNIQUE INDEX IF NOT EXISTS users_wechat_openid_key ON users (wechat_openid);
