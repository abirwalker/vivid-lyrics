declare namespace Spicetify {
  const Player: {
    data?: { item?: { uri?: string; name?: string; type?: string } };
    addEventListener(event: string, cb: (e: any) => void): void;
    removeEventListener(event: string, cb: (e: any) => void): void;
    seek(ms: number): void;
    getProgress(): number;
    isPlaying(): boolean;
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
}
