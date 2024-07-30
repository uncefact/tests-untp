import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import HomeHeroImageUrl from '@site/static/img/home-hero.jpg';
import Layout from '@theme/Layout';

function HomepageHero() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className="home-hero">
      <div className="home-hero__container">
        <div className="home-hero__content">
          <h1 className="home-hero__title">UN Transparency Protocol <br /> Test Suite</h1>
          <p className="home-hero__description">{siteConfig.tagline}</p>
          <div className="home-hero__actions">
            <Link
              className="button button--primary button--lg"
              to={'/docs/mock-apps/'}>
              Get Started
            </Link>
          </div>
        </div>
        <div className="home-hero__image-wrapper rad-10">
          <img src={HomeHeroImageUrl} className="home-hero__image" alt="" />
        </div>
      </div>
    </header>
  );
}

export default function Home() {
  return (
    <Layout
      title="UN Transparency Protocol"
      description="Supporting governments and industry on practical measures to counter greenwashing by implementing supply chain traceability and transparency at the scale needed to achieve meaningful impacts on global sustainability outcomes.">
      <main className="homepage-content">
        <HomepageHero/>
        <HomepageFeatures/>
      </main>
    </Layout>
  );
}
