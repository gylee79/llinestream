// This is a basic type declaration file for Shaka Player to satisfy TypeScript.
// It is not exhaustive but covers the parts of the API used in this project.
declare namespace shaka {
    class Player {
        constructor(videoElement?: HTMLMediaElement);
        configure(config: any): void;
        attach(videoElement: HTMLMediaElement): Promise<void>;
        load(manifestUri: string): Promise<void>;
        addEventListener(event: string, callback: (e: any) => void): void;
        addTextTrackAsync(url: string, language: string, kind: string, mime: string): Promise<void>;
        setTextTrackVisibility(visible: boolean): void;
        destroy(): Promise<void>;
    }

    namespace ui {
        class Overlay {
            constructor(player: shaka.Player, container: HTMLElement, videoElement: HTMLMediaElement);
            destroy(): Promise<void>;
        }
    }
}
