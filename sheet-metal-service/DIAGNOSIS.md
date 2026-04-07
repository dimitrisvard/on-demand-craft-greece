# Sheet Metal Pipeline Diagnosis

## Current Pipeline Architecture

```
User uploads STEP file → S3 (rfq-files bucket via presigned URL)
        │
        ▼
Frontend/Edge Function calls extract-flat-pattern
        │
        ▼
Edge Function (Deno) passes file_url to FreeCAD Docker service
        │
        ▼
FreeCAD Docker (Ubuntu 22.04 + Xvfb + SheetMetal WB)
    ├── Downloads STEP via urllib.request.urlretrieve(file_url)
    ├── Runs freecadcmd subprocess for unfold
    ├── Tries SheetMetal Workbench SMUnfold first
    ├── Falls back to manual BFS-based unfold
    ├── Renders isometric PNG via Xvfb
    ├── Exports DXF with ezdxf
    └── Generates PDF with reportlab
        │
        ▼
Returns ZIP (PDF + DXF + JSON) or JSON flat pattern data
```

## Key Files

| File | Purpose |
|------|---------|
| `scripts/freecad-unfold/Dockerfile` | Ubuntu 22.04 + FreeCAD + Xvfb + SheetMetal WB |
| `scripts/freecad-unfold/app/main.py` | FastAPI: `/unfold`, `/flat-pattern`, `/health` |
| `scripts/freecad-unfold/app/freecad_unfold.py` | Subprocess orchestrator for freecadcmd |
| `scripts/freecad-unfold/app/freecad_unfold_worker.py` | FreeCAD Python worker (actual unfolding) |
| `scripts/freecad-unfold/app/dxf_export.py` | DXF export with OUTLINE + BEND_LINES layers |
| `scripts/freecad-unfold/app/pdf_generator.py` | A4 landscape bending shop drawing |
| `scripts/freecad-unfold/app/flat_pattern_render.py` | Flat pattern rendering on reportlab canvas |
| `supabase/functions/extract-flat-pattern/index.ts` | Edge function: routes STEP→FreeCAD, STL→mesh analysis |

## Root Cause Analysis: S3 Access Failure

### Primary Issue: File Download in Docker Container

The `/flat-pattern` endpoint (line 133-232 of `main.py`) downloads files via:
```python
urllib.request.urlretrieve(file_url, step_path)
```

The `file_url` is a **pre-signed S3 URL** passed from the Supabase Edge Function. 

**Likely failure modes (in order of probability):**

1. **UNFOLD_SERVICE_URL not set**: The edge function checks `Deno.env.get("UNFOLD_SERVICE_URL")` — if this env var isn't configured in the Supabase project, the function returns a 422 error immediately. This is the most likely issue.

2. **Docker DNS resolution**: The `docker-compose.yml` does NOT configure custom DNS servers. If the Docker container can't resolve the S3/Supabase hostname, `urllib.request.urlretrieve` fails silently or times out.

3. **Pre-signed URL expiration**: S3 download URLs from `awsS3Storage.ts` expire after 3600 seconds (1 hour), which should be sufficient. However, if URLs are generated much earlier in the workflow, they could expire.

4. **Network isolation**: The Docker container has no explicit network configuration. If running behind a corporate firewall or in a restricted VPS, outbound HTTPS to S3 may be blocked.

5. **No error propagation**: The edge function's `callFreeCADService` catches ALL errors and returns `null`, making it impossible to distinguish between "service unreachable" and "file download failed":
   ```typescript
   try { ... } catch { return null; }
   ```

### Secondary Issues

- **No S3 credentials in Docker**: The docker-compose.yml only passes `DISPLAY=:99`. No AWS/Supabase credentials. The service relies entirely on pre-signed URLs.
- **No retry logic**: `urllib.request.urlretrieve` has no timeout, retry, or error handling.
- **FreeCAD startup overhead**: ~2-5 seconds per subprocess invocation. Combined with file download, this can exceed timeouts.

## What Works vs. What's Broken

### Works
- Face classification (planar/cylindrical detection)
- Thickness auto-detection via parallel face pairs
- Bend detection (radius, angle, direction)
- Manual unfold algorithm (BFS through face adjacency graph)
- DXF export with proper layers
- PDF generation with reportlab
- The overall architecture and data flow

### Broken / Needs Replacement
- **FreeCAD dependency**: Heavy (500MB+ Docker image), requires Xvfb, slow startup
- **SheetMetal WB unfold**: Often fails, falls back to manual unfold anyway
- **File access**: No robust download with retry/timeout
- **Error handling**: Silent failures in edge function and worker
- **Isometric rendering**: Requires Xvfb display server
- **Manual unfold**: Produces only rectangular outlines (no holes, no curved edges)

## Decision: Replace vs. Fix

**Replace the entire FreeCAD pipeline** with a CadQuery/OCP-based service because:
1. CadQuery includes the same OpenCascade kernel without the FreeCAD GUI overhead
2. No Xvfb needed — purely computational
3. Direct Python API instead of subprocess communication via JSON markers
4. Smaller Docker image (~200MB vs ~800MB)
5. Faster processing (no FreeCAD init time)
6. The manual unfold algorithm can be improved with direct OCC topology access

The existing code provides a good reference for the data structures, API contract, and PDF layout.
