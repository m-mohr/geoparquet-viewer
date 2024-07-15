<template>
  <header id="header">
    <h1>GeoParquet Viewer</h1>
    <button @click="showLoad">Load Data</button>
  </header>
  <main id="main">
    <section v-if="data.length === 0" id="error-container">
      <p>No data available!</p>
    </section>
    <section v-else id="table-container">
      <table id="table">
        <tr>
          <th v-for="column of shownColumns" :key="column">{{ column.name }}</th>
        </tr>
        <tr v-for="(row, i) in data" :key="i">
          <td v-for="j of shownColumnsIndices" :key="`${i}_${j}`">
            {{ row[j] }}
          </td>
        </tr>
      </table>
    </section>
    <section id="map-container"><div id="map"></div></section>
  </main>
  <footer id="footer">
    <span>
      Powered by
      <a href="https://vuejs.org" target="_blank">Vue</a>,
      <a href="https://openlayers.org" target="_blank">OpenLayers</a>, and
      <a href="https://github.com/hyparam/hyparquet" target="_blank">hyparquet</a>
    </span>
    <span>Hosted by <a href="https://github.com" target="_blank">GitHub</a></span>
    <span>Assembled by <a href="https://mohr.ws" target="_blank">Matthias Mohr</a></span>
  </footer>
</template>

<script>
import { parquetRead, parquetMetadataAsync, parquetSchema } from 'hyparquet';
import { compressors as hycompressors } from 'hyparquet-compressors';
import { snappyUncompressor } from 'hysnappy';

import WKB from 'ol/format/WKB.js';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import { OSM, Vector as VectorSource } from 'ol/source.js';
import { Tile as TileLayer, Vector as VectorLayer } from 'ol/layer.js';
import proj4 from 'proj4';
import { register } from 'ol/proj/proj4.js';

register(proj4); // required to support reprojection

const compressors = {
  ...hycompressors,
  snappy: snappyUncompressor()
};

export default {
  name: 'App',
  data() {
    return {
      source: new VectorSource(),
      map: null,
      columns: [],
      data: [],
      url: './airports.parquet',
      rowStart: 0,
      rowEnd: 1000,
      fileSize: null,
      metadata: null
    };
  },
  computed: {
    asyncBuffer() {
      return {
        byteLength: this.fileSize,
        slice: async (start, end) => {
          const rangeEnd = end === undefined ? '' : end - 1;
          const res = await fetch(this.url, {
            headers: {
              Range: `bytes=${start}-${rangeEnd}`
            }
          });
          return res.arrayBuffer();
        }
      };
    },
    geoMetadata() {
      const geo = this.metadata?.key_value_metadata?.find(md => md.key === 'geo');
      if (geo && geo.value) {
        return JSON.parse(geo.value);
      }
      return null;
    },
    schema() {
      return parquetSchema(this.metadata);
    },
    allColumns() {
      const map = {};
      for (const index in this.schema.children) {
        const child = this.schema.children[index];
        map[child.element.name] = parseInt(index, 10);
      }
      return map;
    },
    sortedColumns() {
      return Object.entries(this.allColumns)
        .sort((a, b) => (a[1] - b[1]))
        .map(x => ({index: x[1], name: x[0]}));
    },
    shownColumns() {
      return this.sortedColumns
        .filter(x => !(x.name in this.geoMetadata.columns));
    },
    shownColumnsIndices() {
      return this.shownColumns
        .map(x => x.index);
    }
  },
  watch: {
    url() {
      this.load();
    }
  },
  mounted() {
    this.createMap();
    this.load(this.url);
  },
  methods: {
    reset() {
      this.data = [];
      this.columns = [];
      this.rowStart = 0;
      this.rowEnd = 1000;
      this.fileSize = null;
      this.metadata = null;
      this.source.clear();
    },
    showLoad() {
      const url = prompt('Enter GeoParquet file to load:', this.url);
      if (url) {
        this.url = url;
      }
    },
    async discover() {
      this.reset();
      try {
        const head = await fetch(this.url, { method: 'HEAD' });
        if (!head.ok) {
          throw new Error(`Error (${head.status}) fetching file: ${head.statusText}`);
        }
        const size = head.headers.get('content-length');
        if (!size) {
          throw new Error('No content-length header returned by server');
        }
        this.fileSize = Number(size);
        this.metadata = await parquetMetadataAsync(this.asyncBuffer);
        if (this.columns.length === 0) {
          this.columns = Object.keys(this.allColumns)//.filter(col => !(col in this.geoMetadata.columns));
        }
      } catch (error) {
        this.showError(error.message);
      }
    },
    async load() {
      await this.discover();
      try {
        await parquetRead({
          file: this.asyncBuffer,
          metadata: this.metadata,
          compressors,
          columns: this.columns.length === 0 ? undefined : this.columns,
          rowStart: this.rowStart,
          rowEnd: this.rowEnd,
          onComplete: (data) => (this.data = data)
        });
        await this.parseWKB();
        await this.addToMap();
        console.log(this.geoMetadata);
      } catch (error) {
        this.showError(error.message);
      }
    },
    getValue(row, column) {
      const index = this.allColumns[column];
      return row[index];
    },
    toHex(string) {
      const bytes = new TextEncoder().encode(string);
      return Array.from(
        bytes,
        byte => byte.toString(16).padStart(2, "0")
      ).join("");
    },
    async parseWKB() {
      const format = new WKB();
      const featureOpts = {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857'
      };
      for(const column in this.geoMetadata.columns) {
        const index = this.allColumns[column];
        for (const i in this.data) {
          this.data[i][index] = format.readFeature(this.toHex(this.data[i][index]), featureOpts);
        }
      }
    },
    async addToMap() {
      for (const row of this.data) {
        const feature = this.getValue(row, this.geoMetadata.primary_column);
        this.source.addFeature(feature);
      }
    },
    showError(message) {
      alert(message);
    },
    createMap() {
      this.map = new Map({
        layers: [
          new TileLayer({
            source: new OSM()
          }),
          new VectorLayer({
            source: this.source
          })
        ],
        target: 'map',
        view: new View({
          center: [0, 0],
          zoom: 2
        })
      });
    }
  }
};
</script>

<style>
@import url('../node_modules/ol/ol.css');
html,
body,
#app {
  height: 100%;
  margin: 0;
  padding: 0;
  font-family: sans-serif;
}
#header,
#footer {
  height: 2rem;
  background-color: #333;
  color: #fff;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  padding: 0 0.5rem;
}
#header {
  gap: 1rem;
}
#footer {
  justify-content: center;
  gap: 2rem;
}
#header h1 {
  margin: 0;
  padding: 0;
  font-size: 1.2rem;
  flex-grow: 1;
}
#header a,
#footer a {
  color: #fff;
}
#main {
  height: calc(100% - 4rem);
}
#map-container,
#table-container,
#error-container {
  width: 100%;
  height: 50%;
}
#table-container {
  overflow: auto;
}
#error-container {
  display: flex;
  align-items: center;
  justify-content: center;
}
#table {
  width: 100%;
  border-collapse: collapse;
}
#table td,
#table th {
  border: 1px solid #999;
  padding: 0.3rem;
  font-size: 0.8rem;
}
table th {
  background-color: #ccc;
}
table tr:nth-child(odd) {
  background-color: #f2f2f2;
}
#map {
  width: 100%;
  height: 100%;
}
</style>
