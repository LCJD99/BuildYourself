import './style.css';
export const metadata = { title: 'BuildYourself', description: '让每一步都有迹可循' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="zh-CN"><body>{children}</body></html>; }
