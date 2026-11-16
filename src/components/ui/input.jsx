import * as React from "react"

import { contactError } from '@/lib/contactValidation'

import { cn } from "@/lib/utils"

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  const [touched, setTouched] = React.useState(false);
  const localRef = React.useRef(null);
  const contact = type === 'tel' || type === 'email';
  const error = contact ? contactError(type, props.value, props.required) : '';
  const errorId = React.useId();
  React.useEffect(() => { localRef.current?.setCustomValidity(error); }, [error]);
  return (
    (<> <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
      ref={node => { localRef.current = node; if (typeof ref === 'function') ref(node); else if (ref) ref.current = node; }}
      inputMode={props.inputMode || (type === 'tel' ? 'tel' : type === 'email' ? 'email' : undefined)}
      aria-invalid={touched && !!error || props['aria-invalid']}
      aria-describedby={[props['aria-describedby'], touched && error ? errorId : null].filter(Boolean).join(' ') || undefined}
      onBlur={event => { setTouched(true); props.onBlur?.(event); }}
      onChange={event => { if (contact) event.target.setCustomValidity(contactError(type, event.target.value, props.required)); props.onChange?.(event); }}
      />{touched && error && <p id={errorId} role="alert" className="text-xs text-red-600 mt-1">{error}</p>}</>)
  );
})
Input.displayName = "Input"

export { Input }
