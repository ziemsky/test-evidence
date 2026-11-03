# Test Evidence

Open `index.html` to start with an empty evidence document.

## Generate a populated test document

From the project root, run:

```sh
npm run fixture
```

The command creates `build/test-evidence/index.html` and `build/test-evidence/assets/`. The assets directory contains the three sample SVG screenshots and the JSON attachment; the HTML references these files by relative path. Open `build/test-evidence/index.html` in a browser to use the populated document.

To choose a different output directory, run:

```sh
npm run fixture -- /path/to/output
```

The command writes `index.html` and `assets/` inside that directory. It leaves the tracked project `index.html` unchanged and refuses to use the project root as the output directory. The default `build/` output is ignored by Git.
