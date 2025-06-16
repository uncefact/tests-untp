import clsx from 'clsx';

const FeatureList = [
  {
    title: 'Mock Apps',
    Svg: require('@site/static/img/mock-app-icon.svg').default,
    description: (
      <>
Model a value chain using UNTP and integrate your implementation at any point within the value chain.
</>
    ),
  },
  {
    title: 'Technical Interoperability',
    Svg: require('@site/static/img/technical-interoperability-icon.svg').default,
    description: (
      <>
      Test the technical interoperability of your implementation based on the UNTP specification.
      </>
    ),
  },
  {
    title: 'Semantic Interoperability',
    Svg: require('@site/static/img/semantic-interoperability-icon.svg').default,
    description: (
      <>
Test the semantic interoperability of credentials produced by your implementation against the UNTP specification.      </>
    ),
  },
  {
    title: 'Graph Validation',
    Svg: require('@site/static/img/graph-validation-icon.svg').default,
    description: (
      <>
        Test the entire trust graph produced by your implementation against the UNTP specification.
      </>
    ),
  },
];

function Feature({Svg, title, description}) {
  return (
    <div className={clsx('col col--3 home-feature')}>
      <div className="home-feature__content">
        <div className="home-feature__head">
          <div className="home-feature__image">
            <Svg className="home-feature__icon" role="img" />
          </div>
          <h3 className="home-feature__title">{title}</h3>
        </div>
        <p className="home-feature__description">{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures() {
  return (
    <section className="home-features">
      <div className="home-features__container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}