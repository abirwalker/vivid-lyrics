declare namespace Spicetify {
  const Player: {
    data?: { item?: { uri?: string; name?: string; type?: string } };
    addEventListener(event: string, cb: (e: any) => void): void;
    removeEventListener(event: string, cb: (e: any) => void): void;
    seek(ms: number): void;
    getProgress(): number;
    getDuration?(): number;
    isPlaying(): boolean;
    back?(): void;
    togglePlay?(): void;
    next?(): void;
    getRepeat?(): number;
    setRepeat?(mode: number): void;
    setShuffle?(enabled: boolean): void;
    origin?: { _state?: { shuffle?: boolean; smartShuffle?: boolean; repeat?: number }; _events?: { addListener?(event: string, cb: (e: any) => void): void } };
  };
  const Platform: {
    Session?: { accessToken?: string };
    History: {
      location: { pathname: string };
      listen(cb: (loc: any) => void): void;
    };
  };
  const CosmosAsync: {
    get(url: string): Promise<any>;
    post(url: string, body?: any): Promise<any>;
  };
  const LocalStorage: {
    get(key: string): string | null;
    set(key: string, value: string): void;
  };
  namespace Menu {
    class Item {
      constructor(name: string, isEnabled: boolean, onClick: (self: Item) => void, icon?: string);
      register(): void;
      deregister(): void;
    }
  }
}
