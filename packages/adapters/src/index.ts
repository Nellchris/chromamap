/**
 * @carto-a11y/adapters — loaders that turn external map assets into the plain
 * data structures the engine audits.
 *
 * The concrete loaders (MapLibre style JSON, GeoJSON, raster tile samples)
 * land here as they are built; this module defines the shape they share.
 */

/** A source the auditor can read, named for reporting. */
export interface SourceRef {
  /** Stable identifier used in audit output. */
  readonly id: string;
  /** Where the asset came from: a URL, a file path or `inline`. */
  readonly origin: string;
}

/**
 * A loader turns one reference into parsed data of type `T`.
 *
 * Implementations must not reach for the DOM so that the same adapter runs in
 * the CLI and in the browser.
 */
export interface Adapter<T> {
  /** Short adapter name, e.g. `maplibre-style`. */
  readonly name: string;
  /** True when this adapter recognises the reference. */
  supports(ref: SourceRef): boolean;
  /** Parse the reference into engine-ready data. */
  load(ref: SourceRef): Promise<T>;
}
