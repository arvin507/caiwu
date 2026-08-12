export const metadata = {
  title: 'caiwu-backend',
  description: '财务系统后端 API 服务',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  )
}
