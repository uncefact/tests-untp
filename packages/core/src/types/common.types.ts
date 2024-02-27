import { IGenericFeatureProps } from '../components/GenericFeature';

export interface IFeature extends IGenericFeatureProps {
  name: string;
  id: string;
}

export interface IApp {
  name: string;
  type: string;
  features: IFeature[];

  assets: IAssets;
  styles: IStyles;
}

export interface IAssets {
  logo: string;
  brandTitle: string;
  passportVC: string;
  transactionEventVC: string;
}

export interface IStyles {
  primaryColor: string;
  secondaryColor: string;
  tertiaryColor: string;
}
