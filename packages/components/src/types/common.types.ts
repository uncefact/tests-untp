export interface IComponentFunc {
  onChange: ({ data, errors }: { data: any; errors?: any[] }) => void;
}

export interface BtnStyle {
  color?: string;
  backgroundColor?: string;

  [key: string]: string | undefined;
}
