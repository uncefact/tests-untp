import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import Layout from '@theme/Layout';

function HomepageHero() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className="home-hero">
      <div className="home-hero__container">
        <div className="home-hero__content">
          <h1 className="home-hero__title">{siteConfig.title} <br /> Test Suite</h1>
          <p className="home-hero__description">{siteConfig.tagline}</p>
          <div className="home-hero__actions">
            <Link
              className="button button--primary button--lg"
              to={'/docs/reference-implementation/'}>
              Get Started
            </Link>
          </div>
        </div>
        <div className="home-hero__image-wrapper rad-10">
          <img src={siteConfig.themeConfig.heroImage as string} className="home-hero__image" alt={siteConfig.themeConfig.heroImageAlt as string} />
        </div>
      </div>
    </header>
  );
}

export default function Home() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} Test Suite`}
      description={siteConfig.tagline}>
      <main className="homepage-content">
        <HomepageHero/>
        <HomepageFeatures/>
      </main>
    </Layout>
  );
}
