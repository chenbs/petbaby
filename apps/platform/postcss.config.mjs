// Tailwind 只服务运营后台（src/app/admin/admin.css 里 `@import "tailwindcss"`）。
// 消费端的 globals.css 不含 Tailwind 指令，插件对它原样放行。
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
