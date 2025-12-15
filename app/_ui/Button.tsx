import * as React from "react";
type Props = React.ButtonHTMLAttributes<HTMLButtonElement>;
export default function Button({ className = "", ...props }: Props) {
  return <button className={"rounded-xl px-4 py-2 border " + className} {...props} />;
}

