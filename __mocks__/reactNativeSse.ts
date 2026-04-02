type Listener = (event: any) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  options: Record<string, unknown>;
  listeners = new Map<string, Listener[]>();
  closed = false;

  constructor(url: string, options: Record<string, unknown>) {
    this.url = url;
    this.options = options;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeAllEventListeners(): void {
    this.listeners.clear();
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, event: any): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.forEach(listener => listener(event));
  }

  static reset(): void {
    MockEventSource.instances = [];
  }
}

export default MockEventSource;
