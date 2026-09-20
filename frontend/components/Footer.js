import Link from 'next/link';
import styles from './Footer.module.css';

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.topBorderGlow} />
      <div className="container">
        <div className={styles.footerGrid}>
          {/* Brand & Slogan */}
          <div className={styles.brandCol}>
            <Link href="/" className={styles.logo}>
              <span className={styles.logoRed}>EGY</span>
              <span className={styles.logoWhite}>MAX</span>
            </Link>
            <p className={styles.brandDescription}>
              منصة EGYMAX هي بوابتك الرقمية الأولى لمشاهدة وتحميل أحدث الأفلام والمسلسلات العربية والأجنبية بجودة فائقة وبشكل مجاني وسلس على مدار الساعة.
            </p>
            <div className={styles.featuresPills}>
              <span className={styles.pill}>⚡ سيرفرات صاروخية</span>
              <span className={styles.pill}>🍿 ترجمة احترافية</span>
              <span className={styles.pill}>🎬 جودة 4K / 1080p</span>
            </div>
          </div>

          {/* Quick Links */}
          <div className={styles.linksCol}>
            <h4 className={styles.columnTitle}>روابط سريعة</h4>
            <ul className={styles.linksList}>
              <li><Link href="/">الرئيسية</Link></li>
              <li><Link href="/movies">جميع الأفلام</Link></li>
              <li><Link href="/movies?year=2026">أفلام 2026</Link></li>
              <li><Link href="/movies?quality=1080p">الأعلى تقييماً</Link></li>
              <li><Link href="/categories">تصفح التصنيفات</Link></li>
            </ul>
          </div>

          {/* Categories Links */}
          <div className={styles.linksCol}>
            <h4 className={styles.columnTitle}>الأقسام والأنواع</h4>
            <ul className={styles.linksList}>
              <li><Link href="/movies?genre=action">أفلام أكشن</Link></li>
              <li><Link href="/movies?genre=thriller">إثارة وغموض</Link></li>
              <li><Link href="/movies?genre=comedy">أفلام كوميدية</Link></li>
              <li><Link href="/movies?genre=scifi">خيال علمي</Link></li>
              <li><Link href="/movies?genre=drama">دراما عائلية</Link></li>
            </ul>
          </div>

          {/* Legal / Notice */}
          <div className={styles.noticeCol}>
            <h4 className={styles.columnTitle}>إخلاء مسؤولية قانوني</h4>
            <p className={styles.noticeText}>
              كافة المواد والأفلام المتاحة على موقع EGYMAX يتم جلبها من مصادر وسيرفرات خارجية عبر الإنترنت ومواقع البث العامة. الموقع لا يقوم برفع أو تخزين أي محتوى فيديو على خوادمه إطلاقاً.
            </p>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className={styles.bottomBar}>
          <p className={styles.copyright}>
            © 2026 <span className={styles.bold}>EGYMAX</span> - جميع الحقوق محفوظة
          </p>
          <div className={styles.bottomLinks}>
            <span>تصميم وتطوير فائق الأداء</span>
            <span className={styles.divider}>•</span>
            <Link href="/">سياسة الاستخدام</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
