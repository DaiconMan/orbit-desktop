# Cloud Sync

Shows how much space cloud-synced folders really take on this Mac. These are the File Provider folders in
`~/Library/CloudStorage`, such as OneDrive, Google Drive and Dropbox. With Files On-Demand, only downloaded
files take space; online-only files count as 0.

Each folder shows:
* its used size
* the number of downloaded files out of all files
* a meter against the warning threshold; above `warn_gb` it turns the warning colour

* needs: `cloud` (enable `providers.cloud`)
* provider options: `providers.cloud.folders` (list of `{name, path}`; empty means every folder in
  `~/Library/CloudStorage`), `interval_minutes` (default 10; walking a big folder is heavy), `warn_gb` (default 5)
* settings: `title`

Freeing space (making files online-only) is up to the provider app or a script of your own; this widget only
reads file metadata and never downloads anything.
