const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// 加载真实钱包代码，仅替换网络与支付边界，页面测试仍走实际 402 重放逻辑。
function loadWallet(api, payment) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../services/wallet.js"), "utf8"), {
    module,
    require(name) {
      if (name === "./api") return api;
      if (name === "./payment") return payment || { pay: async () => undefined };
      throw new Error(name);
    }
  });
  return module.exports;
}

module.exports = { loadWallet };
