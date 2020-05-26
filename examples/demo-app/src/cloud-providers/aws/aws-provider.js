// Copyright (c) 2020 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

import AwsIcon from './aws-icon';
import {Provider} from 'kepler.gl/cloud-providers';
import window from 'global';
import 'aws-sdk';
import {Auth, Storage} from 'aws-amplify';
import {MAP_URI} from '../../constants/default-settings';
import {AWS_LOGIN_URL, AWS_WEB_CLIENT_ID} from './aws-login';

const PROVIDER_NAME = 'aws';
const DISPLAY_NAME = 'AWS';
const PRIVATE_STORAGE_ENABLED = true;
const SHARING_ENABLED = true;

// Here you can configure if share url uses mapUrl or loadParams, e.g.:
// Sharing with map url: http://localhost:8080/demo/map?mapUrl=''
// Sharing with loadParams (only works if user is logged in):
// http://localhost:8080/demo/map/aws?level=protected&mapId=''&identityId=''
const SHARING_WITH_MAP_URL = true;

// If sharing url with mapUrl, here you can configure the expiration time in seconds:
// Per default in AWS backend maximal time is one hour
const EXPIRE_TIME_IN_SECONDS = 60 * 60;

export default class AwsProvider extends Provider {
  constructor(accountName) {
    super({name: PROVIDER_NAME, displayName: accountName || DISPLAY_NAME, icon: AwsIcon});
    this.clientId = AWS_WEB_CLIENT_ID;

    this._currentUser = this.clientId
      ? this._getUserInfo().then(currentUser => currentUser)
      : {id: '', username: ''};

    this._loadParam = {level: '', mapId: '', identityId: ''};
    this._shareUrl = '';
  }

  /**
   *
   * @param onCloudLoginSuccess
   */
  async login(onCloudLoginSuccess) {
    if (!this.clientId) {
      // Log the error:
      Auth.currentUserInfo().catch();
      return;
    }
    const link = `${window.location.protocol}//${window.location.host}/${AWS_LOGIN_URL}`;
    const style = `location, toolbar, resizable, scrollbars, status, width=500, height=440, top=200, left=400`;
    const authWindow = window.open(link, 'awsCognito', style);

    // if authWindow is null, it could not be opened
    const handleLogin = async e => {
      if (authWindow.location.href === link) {
        if (authWindow) {
          authWindow.close();
        }

        window.removeEventListener('message', handleLogin);

        if (e.data.success) {
          this._getUserInfo()
            .then(currentUser => {
              this._currentUser = currentUser;
            })
            .catch();
          onCloudLoginSuccess();
        }
      }
    };
    window.addEventListener('message', handleLogin);
  }

  /**
   *
   * @returns {Array<Viz>}
   */
  async listMaps() {
    const publicMaps = this._getMapListFromStorage('public');
    const privateMaps = this._getMapListFromStorage('private');
    return Promise.all([publicMaps, privateMaps])
      .then(values => values.flat())
      .catch(e => AwsProvider._handleError(e));
  }

  _getMapListFromStorage(level) {
    return Storage.list('', {level})
      .then(result => AwsProvider._prepareFileList(result, level))
      .catch(e => {
        const capitalizedLevel = level.charAt(0).toUpperCase() + level.slice(1);
        AwsProvider._handleError(`${capitalizedLevel} maps failed to load`, e);
      });
  }

  /**
   * Generates array of viz objects from list of files from storage
   * @returns {Array<Viz>}
   */
  static async _prepareFileList(fileList, level) {
    const mapFileList = fileList.filter(file => file.key.endsWith('map.json'));

    const updatedFileList = mapFileList.map(file => {
      const title = file.key.split('.')[0];
      const thumbnailKey = `${title}.thumbnail.png`;
      const metaKey = `${title}.meta.json`;

      const fileData = {
        id: file.key,
        title,
        description: '',
        privateMap: level === 'private',
        thumbnail: '',
        lastModification: new Date(Date.parse(file.lastModified)),
        loadParams: {
          identityId: '',
          mapId: file.key,
          level
        }
      };

      const thumbnailUrl = fileList.some(f => f.key === thumbnailKey)
        ? this._getFile(thumbnailKey, 'image', {level, download: false})
        : null;
      const description = fileList.some(f => f.key === metaKey)
        ? this._getFile(metaKey, 'meta data', {level, download: true})
        : 'No description meta data file';

      return Promise.all([thumbnailUrl, description])
        .then(respList => {
          fileData.thumbnail = respList[0];
          fileData.description = respList[1];
        })
        .then(resp => fileData)
        .catch(e => this._handleError(e));
    });
    return Promise.all(updatedFileList);
  }

  /**
   *
   * @returns {MapResponse}
   */
  async downloadMap(loadParams) {
    const {level, mapId, identityId} = loadParams;
    return Storage.get(mapId, {level, ...(level === 'private' ? {} : {identityId})})
      .then(fetch)
      .then(response => response.json())
      .then(mapData => {
        if (this._loadParam !== loadParams) {
          this._loadParam = loadParams;
        }
        return {
          map: mapData,
          format: 'keplergl'
        };
      })
      .catch(e => AwsProvider._handleError(`Map downloading failed`, e));
  }

  /**
   * Save if isPublic false or
   * ShareUrl if isPublic true
   * @returns {Promise<{level, mapId, identityId} || {shareUrl}>}
   * You can share url with saved map through public map link (as defined)
   * or through loadParams used in downloadMap (set SHARING_WITH_MAP_URL to false to use)
   * in second case, the user has to be logged in to open the map
   */
  async uploadMap({mapData, options = {}}) {
    const {isPublic} = options;
    const {map, thumbnail} = mapData;
    const {title, description} = map && map.info;
    const name = title;
    // Since we share through a map link, this could be private as well
    const level = isPublic ? 'protected' : 'private';
    const saveThumbnail = this._saveFile(name, 'thumbnail.png', thumbnail, level);
    const saveMeta = this._saveFile(name, 'meta.json', {description}, level);
    const saveMap = this._saveFile(name, 'map.json', map, level);

    return Promise.all([saveThumbnail, saveMeta, saveMap])
      .then(savedList => {
        const key = savedList && savedList[2] && savedList[2].key;
        this._loadParam = {level, mapId: key};
        // if public, url for sharing is created:
        if (isPublic) {
          if (SHARING_WITH_MAP_URL) {
            const config = {download: false, level, expires: EXPIRE_TIME_IN_SECONDS};
            return AwsProvider._getFile(key, 'map', config).then(url => {
              this._shareUrl = encodeURIComponent(url);
              return {shareUrl: this.getShareUrl(true)};
            });
          }
          this._loadParam.identityId = this._currentUser && this._currentUser.id;
          return {shareUrl: this.getShareUrl(true)};
        }
        // if not public, map is saved and private map url is created
        return this._loadParam;
      })
      .catch(e => AwsProvider._handleError(`Error at saving ${name} files`, e));
  }

  /**
   *
   * @param onCloudLogoutSuccess
   */
  async logout(onCloudLogoutSuccess) {
    Auth.signOut()
      .then(() => {
        this._currentUser = null;
        onCloudLogoutSuccess();
      })
      .catch(e => AwsProvider._handleError('Signing out failed', e));
  }

  /**
   *
   * @returns {boolean}
   */
  hasPrivateStorage() {
    return PRIVATE_STORAGE_ENABLED;
  }

  isEnabled() {
    return Boolean(this.clientId);
  }

  /**
   *
   * @returns {boolean}
   */
  hasSharingUrl() {
    return SHARING_ENABLED;
  }

  getAccessToken() {
    return Boolean(this._currentUser && this._currentUser.id);
  }

  getUserName() {
    return (this._currentUser && this._currentUser.username) || '';
  }

  getShareUrl(fullUrl) {
    let shareUrl;
    if (SHARING_WITH_MAP_URL) {
      shareUrl = `${MAP_URI}${this._shareUrl}`;
    } else {
      const {level, mapId, identityId} = this._loadParam;
      shareUrl = `demo/map/${PROVIDER_NAME}?level=${level}&mapId=${mapId}&identityId=${identityId}`;
    }
    return fullUrl
      ? `${window.location.protocol}//${window.location.host}/${shareUrl}`
      : `/${shareUrl}`;
  }

  getMapUrl(fullURL) {
    const {level, mapId, identityId} = this._loadParam;
    let mapUrl = `demo/map/${PROVIDER_NAME}?level=${level}&mapId=${mapId}`;
    if (identityId && identityId !== (this._currentUser && this._currentUser.id)) {
      mapUrl = `${mapUrl}&identityId=${identityId}`;
    }
    return fullURL
      ? `${window.location.protocol}//${window.location.host}/${mapUrl}`
      : `/${mapUrl}`;
  }

  _getUserInfo() {
    return Auth.currentUserInfo()
      .then(userInfo => {
        return {
          id: userInfo && userInfo.id,
          username: userInfo && userInfo.attributes && userInfo.attributes.email
        };
      })
      .then(currentUserInfo => currentUserInfo)
      .catch(e => {
        AwsProvider._handleError(`User information failed to load`, e);
      });
  }

  _saveFile(name, suffix, content, level, metadata) {
    let contentType = '';
    if (suffix === 'thumbnail.png') {
      contentType = 'images/png';
    }
    if (suffix === 'map.json') {
      contentType = 'application/json';
    }
    if (suffix === 'meta.json') {
      contentType = 'application/json';
    }

    return Storage.put(`${name}.${suffix}`, content, {
      level,
      contentType,
      metadata
    })
      .then(resp => resp)
      .catch(e => {
        AwsProvider._handleError(`Saving ${name}.${suffix} file failed`, e);
      });
  }

  static _getFile(key, fileType, config) {
    const {level, download, expires} = config;
    return Storage.get(key, {
      level,
      download,
      expires
    })
      .then(file => {
        if (fileType === 'meta data') {
          return file.Body && file.Body.description
            ? file.Body.description
            : 'No description available.';
        }
        return file;
      })
      .then(resp => resp)
      .catch(e => {
        AwsProvider._handleError(`Getting ${fileType} file ${key} failed`, e);
      });
  }

  static _handleError(message, error) {
    throw new Error(`${message}, error message: 
      ${error && error.message}`);
  }
}
