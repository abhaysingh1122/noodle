import logo from "../assets/logo.svg";

export function Logo({ size = 28 }: { size?: number }) {
  return <img src={logo} width={size} height={size} alt="" className="logo" draggable={false} />;
}
