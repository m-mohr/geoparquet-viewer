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
          <th v-for="field of fields" :key="field.name">
            {{ field.name }} ({{ field.type }})
          </th>
        </tr>
        <tr v-for="(row, i) in data" :key="i">
          <td v-for="field of fields" :key="`${i}_${field.name}`">{{ row.properties[field.name] }}</td>
        </tr>
      </table>
    </section>
    <section id="map-container"><div id="map"></div></section>
  </main>
  <footer id="footer">
    <span>
      Powered by 
      <a href="https://vuejs.org" target="_blank">Vue</a>,
      <a href="https://openlayers.org" target="_blank">OpenLayers</a>,
      <a href="https://github.com/kylebarron/parquet-wasm" target="_blank">parquet-wasm</a>,
      and <a href="https://loaders.gl" target="_blank">loaders.gl</a>
    </span>
    <span>Hosted by <a href="https://github.com" target="_blank">GitHub</a></span>
    <span>Assembled by <a href="https://mohr.ws" target="_blank">Matthias Mohr</a></span>
  </footer>
</template>

<script>
import {ParquetLoader} from '@loaders.gl/parquet';
import {loadInBatches} from '@loaders.gl/core';

import GeoJSON from 'ol/format/GeoJSON.js';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import {OSM, Vector as VectorSource} from 'ol/source.js';
import {Tile as TileLayer, Vector as VectorLayer} from 'ol/layer.js';
import proj4 from 'proj4';
import {register} from 'ol/proj/proj4.js';

register(proj4); // required to support reprojection

export default {
  name: 'App',
  data() {
    return {
      source: new VectorSource(),
      map: null,
      fields: [],
      data: [],
      url: 'https://raw.githubusercontent.com/visgl/loaders.gl/master/modules/parquet/test/data/geoparquet/airports.parquet',
      options: {
        worker: false,
        parquet: {
          shape: 'geojson-table',
          preserveBinary: true
        }
      }
    }
  },
  computed: {
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
      this.fields = [];
      this.source.clear();
    },
    showLoad() {
      const url = prompt('Enter GeoParquet file to load:', this.url);
      if (url) {
        this.url = url;
      }
    },
    async load() {
      this.reset();
      const geojson = new GeoJSON();
      try {
        const batches = await loadInBatches(this.url, ParquetLoader, this.options);
        for await (const batch of batches) {
          if (this.fields.length === 0) {
            this.fields = batch.data.schema.fields.filter(field => !field.name.startsWith('geo')); // todo
          }
          this.data = this.data.concat(batch.data.features);
          for (const feature of batch.data.features) {
            try {
              const olFeature = geojson.readFeature(feature, {
                dataProjection: 'EPSG:4326',
                featureProjection: 'EPSG:3857',
              });
              this.source.addFeature(olFeature);
            } catch (error) {
              console.error(error);
            }
          }
        }
      } catch (error) {
        alert(error.message);
      }
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
          zoom: 2,
        }),
      });
    }
  }
}
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
