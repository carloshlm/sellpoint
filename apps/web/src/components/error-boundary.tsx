import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Punto único para reportar a un servicio de errores más adelante
    console.error("ErrorBoundary atrapó:", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main
          className="flex min-h-screen flex-col items-center justify-center gap-4"
          data-testid="error-fallback"
        >
          <h1 className="text-2xl font-semibold">Algo salió mal</h1>
          <p className="text-muted-foreground">Recargá la página para continuar.</p>
          <button
            type="button"
            className="rounded-lg border px-4 py-2"
            onClick={() => window.location.reload()}
          >
            Recargar
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}
