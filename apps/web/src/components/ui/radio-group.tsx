import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * F1-WEB-ONBOARD-02. Primitiva nueva, mismo patrón que `ui/checkbox.tsx`:
 * `RadioGroupPrimitive.Item` es un `<button role="radio">` de radix (no un
 * `<input>`), maneja `aria-checked`/`data-state` solo — evita el lint
 * `a11y/useSemanticElements` que dispara si se escribe `role="radio"` a
 * mano en JSX.
 */
function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root data-slot="radio-group" className={cn(className)} {...props} />;
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item data-slot="radio-group-item" className={cn(className)} {...props} />
  );
}

export { RadioGroup, RadioGroupItem };
