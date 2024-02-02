interface IFormProps {
  feature: object;
}

function Form({ feature }: IFormProps) {
  console.log(feature)
  return <div>{JSON.stringify(feature)}</div>
}

export default Form;