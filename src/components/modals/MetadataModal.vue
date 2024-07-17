<template>
  <Modal width="80%" title="Parquet Metadata">
    <pre>{{ formatted }}</pre>
  </Modal>
</template>

<script>
import Modal from './Modal.vue';

export default {
  name: 'AboutModal',
  components: {
    Modal
  },
  props: {
    data: {
      type: Object,
      required: true
    }
  },
  computed: {
    formatted() {
      return JSON.stringify(this.data, null, 2);
    }
  }
};
</script>
