import { FormRecuperar } from "../../formularios";
import { Titulo } from "../../titulo";

export default function Recuperar() {
  return (
    <>
      <Titulo detalle="Te enviaremos un enlace para definir una clave nueva.">¿Olvidaste tu clave?</Titulo>
      <FormRecuperar />
    </>
  );
}
