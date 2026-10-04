import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { TurnstileController, type TurnstileAction } from '@/utils/turnstile';

export interface TurnstileWidgetHandle {
  /** A single-use token read right now, or null (the form then submits without one). */
  getToken(): Promise<string | null>;
  /** Asks the widget for a fresh token; call after every submit attempt. */
  reset(): void;
}

interface TurnstileWidgetProps {
  action: TurnstileAction;
  className?: string;
}

/**
 * Turnstile widget for a form. Render it inside the `<form>`: the script loads on
 * the first `focusin` or `pointerdown` inside that form (or at submit), never
 * before. Renders nothing when the build has no site key.
 */
const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(({ action, className }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<TurnstileController | null>(null);
  if (controllerRef.current === null) controllerRef.current = new TurnstileController(action);
  const controller = controllerRef.current;

  useImperativeHandle(
    ref,
    () => ({
      getToken: () => controller.getToken(),
      reset: () => controller.reset(),
    }),
    [controller],
  );

  useEffect(() => {
    if (!controller.enabled) return undefined;
    const container = containerRef.current;
    controller.attach(container);
    const form = container?.closest('form') ?? null;
    const onInteraction = () => {
      form?.removeEventListener('focusin', onInteraction);
      form?.removeEventListener('pointerdown', onInteraction);
      void controller.activate();
    };
    form?.addEventListener('focusin', onInteraction);
    form?.addEventListener('pointerdown', onInteraction);
    return () => {
      form?.removeEventListener('focusin', onInteraction);
      form?.removeEventListener('pointerdown', onInteraction);
      controller.destroy();
    };
  }, [controller]);

  if (!controller.enabled) return null;
  return <div ref={containerRef} className={className} data-turnstile-slot={action} />;
});

TurnstileWidget.displayName = 'TurnstileWidget';

export default TurnstileWidget;
