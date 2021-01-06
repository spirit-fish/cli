const axios = require('axios');
const { validate: validateUUID } = require('uuid');

const SpiritFish = {
  HATCHERY_URL: 'https://www.spirit.fish',
  renderersIndex(token) {
    return axios.get(`${SpiritFish.HATCHERY_URL}/api/v1/renderers`, {
      headers: {
        'X-Hatchery-CLI-Token': token,
        'Content-Type': 'application/json'
      }
    }).then(response => response.data);
  },
  resolveRenderer(token, rendererIdOrString) {
    if (validateUUID(rendererIdOrString)) return Promise.resolve(rendererIdOrString);
    return SpiritFish.renderersIndex(token).then(renderers => {
      const renderer = renderers.find(r => {
        return r.nickname === rendererIdOrString;
      });
      if (!renderer) return false;
      return renderer.id;
    });
  },
  rendererShow(token, rendererId) {
    return axios.get(`${SpiritFish.HATCHERY_URL}/api/v1/renderers/${rendererId}`, {
      headers: {
        'X-Hatchery-CLI-Token': token,
        'Content-Type': 'application/json'
      }
    }).then(response => response.data);
  },
  deploymentCreate(token, rendererId, data) {
    return axios.post(`${SpiritFish.HATCHERY_URL}/api/v1/renderers/${rendererId}/deployments`, {
      data
    }, {
      headers: {
        'X-Hatchery-CLI-Token': token,
        'Content-Type': 'application/json'
      }
    }).then(response => response.data);
  },
  deploymentUpdate(token, rendererId, deploymentId, data) {
    return axios.patch(`${SpiritFish.HATCHERY_URL}/api/v1/renderers/${rendererId}/deployments/${deploymentId}`, {
      data
    }, {
      headers: {
        'X-Hatchery-CLI-Token': token,
        'Content-Type': 'application/json'
      }
    }).then(response => response.data);
  },
  invalidationCreate(token, rendererId, paths = '*') {
    return axios.post(`${SpiritFish.HATCHERY_URL}/api/v1/renderers/${rendererId}/invalidations`, {
      invalidation: { pages: paths.split(",").map(p => p.trim()) }
    }, {
      headers: {
        'X-Hatchery-CLI-Token': token,
        'Content-Type': 'application/json'
      }
    }).then(response => response.data);
  },
  tokenCreate(token) {
    return axios.post(`${SpiritFish.HATCHERY_URL}/api/v1/cli_tokens`, {}, {
      headers: {
        'X-Hatchery-CLI-Token': token,
        'Content-Type': 'application/json'
      }
    }).then(response => response.data);
  },
  currentUser(token) {
    return axios.get(`${SpiritFish.HATCHERY_URL}/api/v1/users/current`, {
      headers: {
        'X-Hatchery-CLI-Token': token,
        'Content-Type': 'application/json'
      }
    }).then(response => response.data);
  },
};

module.exports = SpiritFish;
