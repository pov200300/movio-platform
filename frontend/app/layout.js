import './globals.css';
import Navbar from '../components/Navbar';

export const metadata = {
  title: 'CineVault | Premium Authorized Streaming',
  description: 'Stream legally licensed movies, documentaries, and public domain media in full HD.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Navbar />
        <main className="main-content">
          {children}
        </main>
        <footer className="footer">
          <div className="container">
            <p>© {new Date().getFullYear()} CineVault Platform. All rights reserved.</p>
            <p style={{ fontSize: '0.8rem', marginTop: '0.4rem', opacity: 0.7 }}>
              Legal Compliance Notice: All video streams hosted via this portal are strictly public domain or legally authorized content.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
