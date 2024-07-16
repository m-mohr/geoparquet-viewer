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
        <thead>
          <tr>
            <th v-for="column of shownColumns" :key="column">{{ column.name }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, i) in data"
            :key="i"
            @click="selectOnMap(i)"
            :id="`row${i}`"
            :class="{ highlight: i === selected }"
          >
            <td v-for="j of shownColumnsIndices" :key="`${i}_${j}`">
              <div>{{ row[j] }}</div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="offset !== null" class="loadmore">
        <button @click="loadMore">Load more...</button>&nbsp;
        <button @click="loadAll">Load all...</button>
      </div>
    </section>
    <section id="map-container"><div id="map"></div></section>
    <section id="loading" v-if="loading">Loading...</section>
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
import Select from 'ol/interaction/Select.js';
import { OSM, Vector as VectorSource } from 'ol/source.js';
import { Circle, Fill, Stroke, Style } from 'ol/style.js';
import { Tile as TileLayer, Vector as VectorLayer } from 'ol/layer.js';
import proj4 from 'proj4';
import { register } from 'ol/proj/proj4.js';

register(proj4); // required to support reprojection

const compressors = {
  ...hycompressors,
  snappy: snappyUncompressor()
};

function getDefaults() {
  return {
    data: [],
    columns: [],
    offset: 0,
    pageSize: 500,
    fileSize: null,
    metadata: null,
    loading: false,
    selected: null
  };
}

function getStyle(color = '#3399CC') {
  const fill = new Fill({
    color: 'rgba(255,255,255,0.4)'
  });
  const stroke = new Stroke({
    color,
    width: 1.25
  });
  return new Style({
    image: new Circle({
      fill: fill,
      stroke: stroke,
      radius: 5
    }),
    fill: fill,
    stroke: stroke
  });
}

export default {
  name: 'App',
  data() {
    return Object.assign(
      {
        source: new VectorSource(),
        map: null,
        url: './airports.parquet',
        defaultStyle: getStyle(),
        selectStyle: getStyle('#FF0000')
      },
      getDefaults()
    );
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
      const geo = this.metadata?.key_value_metadata?.find((md) => md.key === 'geo');
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
        .sort((a, b) => a[1] - b[1])
        .map((x) => ({ index: x[1], name: x[0] }));
    },
    shownColumns() {
      return this.sortedColumns.filter((x) => !(x.name in this.geoMetadata.columns));
    },
    shownColumnsIndices() {
      return this.shownColumns.map((x) => x.index);
    }
  },
  watch: {
    url() {
      this.load();
    }
  },
  mounted() {
    this.createMap();
    this.load();
  },
  methods: {
    unselectFeature() {
      if (this.selected === null) {
        return;
      }
      this.setFeatureStyle(this.selected, this.defaultStyle);
    },
    selectFeature() {
      const feature = this.setFeatureStyle(this.selected, this.selectStyle);
      const extent = feature.getGeometry().getExtent();
      this.map.getView().fit(extent, { minResolution: 1000 });
    },
    setFeatureStyle(id, style) {
      const feature = this.source.getFeatureById(id);
      feature.setStyle(style);
      return feature;
    },
    select(i) {
      this.unselectFeature();
      this.selected = i;
    },
    selectOnMap(i) {
      this.select(i);
      this.selectFeature('#FF0000');
    },
    selectInTable(i) {
      this.select(i);
      document.getElementById(`row${i}`).scrollIntoView();
    },
    reset() {
      const defaults = getDefaults();
      for (const key in defaults) {
        this[key] = defaults[key];
      }
      this.source.clear();
    },
    showLoad() {
      const url = prompt('Enter GeoParquet file to load:', this.url);
      if (url) {
        this.url = url;
      }
    },
    async discover() {
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
          this.columns = Object.keys(this.allColumns);
        }
      } catch (error) {
        this.showError(error.message);
      }
    },
    async load() {
      this.reset();
      await this.loadMore();
    },
    async loadAll() {
      this.pageSize = 0;
      await this.loadMore();
    },
    async loadMore() {
      if (this.offset === null) {
        return;
      }
      this.loading = true;
      try {
        if (this.fileSize === null) {
          await this.discover();
        }
        const rowStart = this.offset;
        let rowEnd = undefined;
        if (this.pageSize) {
          rowEnd = this.offset + this.pageSize;
        }
        await parquetRead({
          file: this.asyncBuffer,
          metadata: this.metadata,
          compressors,
          columns: this.columns.length === 0 ? undefined : this.columns,
          rowStart,
          rowEnd,
          utf8: false, // Don't convert binary data as UTF-8, otherwise we can't read the WKB properly
          onComplete: (data) => {
            this.loading = false;
            data.forEach((x) => this.data.push(x));
            if (!this.pageSize || data.length < this.pageSize) {
              this.offset = null;
            } else {
              this.offset += data.length;
            }
          }
        });
        await this.parseWKB();
        await this.addToMap();
      } catch (error) {
        this.showError(error.message);
      } finally {
        this.loading = false;
      }
    },
    getValue(row, column) {
      const index = this.allColumns[column];
      return row[index];
    },
    async parseWKB() {
      const format = new WKB();
      const featureOpts = {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857'
      };
      for (const column in this.geoMetadata.columns) {
        const index = this.allColumns[column];
        for (const i in this.data) {
          const feature = format.readFeature(this.data[i][index], featureOpts);
          feature.setId(i);
          this.data[i][index] = feature;
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
      const select = new Select({ style: this.selectStyle });
      select.on('select', (e) => this.selectInTable(parseInt(e.selected[0].getId(), 10)));
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
      this.map.addInteraction(select);
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
  border-collapse: separate;
  border-spacing: 0;
}
#table thead {
  position: sticky;
  top: 0;
  box-shadow: 0 2px 2px -1px rgba(0, 0, 0, 0.4);
}
#table td,
#table th {
  border-width: 0 1px 1px 0;
  border-color: #555;
  border-style: solid;
  font-size: 0.8rem;
  max-width: 10rem;
}
#table td > div {
  padding: 0.3rem;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 3rem;
  overflow: auto;
  word-wrap: break-word;
}
#table tr.highlight {
  background-color: #ff9999;
}
table th {
  background-color: #ccc;
  padding: 0.3rem;
}
table tr:nth-child(odd) {
  background-color: #f2f2f2;
}
#map {
  width: 100%;
  height: 100%;
}
#loading {
  position: absolute;
  bottom: 1%;
  left: 1%;
  background-color: rgba(0, 0, 0, 0.5);
  color: #fff;
  padding: 0.5rem;
}
.loadmore {
  text-align: center;
  padding: 0.5rem;
}
</style>
