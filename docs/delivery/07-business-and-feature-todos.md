# 未完成业务与功能事项

更新：2026-09-21 ｜ 范围：网站、小程序前端、小程序后端

本文是[开发与配置台账](06-development-and-configuration-todos.md)的业务视图，只列仍需业务决策、第三方配置或真实验收的事项。支付、权益、退款和前端交互代码已完成，不重复列为开发待办；纯功能状态以[纯功能开发待办](../product/07-functional-backlog.md)为准。

## 一、网站发布

- 提供并确认主体名称、联系方式、办公地址、服务商与存储地域、ICP 备案号、真实小程序码和法务批准文案。
- 填入官网发布变量，运行 `pnpm check:release --dist apps/website/dist`，通过后发布到 `https://www.babykitty.cn`。

依据：[官网规格](../website/01-KittyPaw复刻规格.md)、[官网实现说明](../website/03-独立官网实现说明.md)。

## 二、小程序上线

- 提供真实 AppID/AppSecret、上传私钥和体验成员，登记 request/uploadFile/downloadFile 合法域名及 HTTPS 证书。
- 在微信开发者工具 Nightly 完成预览、体验版、提审、灰度、回滚和最低基础库真机验收。
- 在已开通虚拟支付的安卓/鸿蒙/Windows 沙箱及 iOS 真机完成支付、到账、退款和 iOS 退款问询验证。

依据：[小程序发布](03-miniprogram-release.md)、[外部前置条件](../operations/04-external-prerequisites.md)。

## 三、支付与履约决策

- 完成微信主体认证、普通支付和虚拟支付签约、Offer/商品上架、现网与沙箱 AppKey、`productId` 和价格配置。
- 明确每个收费 SKU 的虚拟/普通支付归类，复核支付费率后的价格和毛利，确定会员及权益的退款判定与回收规则。
- 提供实体供应商并完成印刷、发货、退款和地址加密的真实联调。

依据：[纯功能开发待办](../product/07-functional-backlog.md)、[支付改造方案](../product/23-虚拟支付合规改造方案.md)。

## 四、宠物人化 V2

- 40 个自有特效保持 `pending-review`，取得书面批准后才可上传、seed、冻结或设为 `live`，再按哈希、双参考顺序、候选数、授权和盲评清单验收。

**范围边界：** 宠物档案、照片库、模板货架、主人照片、宠物人化生成链路、时间线、健康记录、纪念产品和管理后台等既定功能已实现；亲友共建、社区及新增艺术模板不在当前范围。
