export interface IComponentFunc {
  onChange: ({ data, errors }: { data: any; errors?: any[] }) => void;
}
