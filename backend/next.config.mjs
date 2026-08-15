/** @type {import('next').NextConfig} */
const nextConfig = {
  // 构建产物目录用当前不存在的新名（.next_run2），确保 next dev 启动时只创建、不清理
  // 旧缓存——否则清理已存在的缓存目录会触发 WorkBuddy safe-delete 的 bulk 删除拦截
  // （阈值 50，跨 turn 累计，本会话已累积>50，任何 unlink 都会被拦），导致 next 启动/
  // 重启崩溃。旧 .next/.next_dev/.next_run 残留无害，待 safe-delete 放行相关目录后统一清理。
  // 注：不要在此加 webpack.watchOptions.ignored —— next 默认 ignored 非纯字符串数组，
  // 合并后会触发 webpack schema 校验失败导致 next 崩溃。
  distDir: '.next_run2',
};

export default nextConfig;
