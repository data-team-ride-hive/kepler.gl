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
const EXPIRE_TIME_IN_SECONDS = 60 * 60;

export default class AwsProvider extends Provider {
  constructor(accountName) {
    super({name: PROVIDER_NAME, displayName: accountName || DISPLAY_NAME, icon: AwsIcon});
  }

  /**
   * Required!
   *
   * @param onCloudLoginSuccess
   */
  async login(onCloudLoginSuccess) {
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
          onCloudLoginSuccess();
        }
      }
    };
    window.addEventListener('message', handleLogin);
  }

  /**
   * Required!
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
        ? this._getFile(thumbnailKey, level, 'image', false)
        : null;
      const description = fileList.some(f => f.key === metaKey)
        ? this._getFile(metaKey, level, 'meta data', true)
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
   * Required!
   *
   * @returns {MapResponse}
   */
  async downloadMap(loadParams) {
    const {level, mapId, identityId} = loadParams;
    const mapURL =
      level === 'private'
        ? await Storage.get(mapId, {level})
        : await Storage.get(mapId, {level, identityId});

    const mapData = await fetch(mapURL).then(response => response.json());
    this._loadParam = loadParams;

    return {
      map: mapData,
      format: 'keplergl'
    };
  }

  /**
   * Save if isPublic false or
   * ShareUrl if isPublic true
   * @returns {Promise<{level, mapId, identityId} || {shareUrl}>}
   * You can share url with saved map through public map link (as defined)
   * or through loadParams used in downloadMap (commented - uncomment to use)
   * in second case, the user has to be logged in to open the map
   */
  async uploadMap({mapData, options = {}}) {
    const {isPublic} = options;
    const {map, thumbnail} = mapData;
    const {title, description} = map && map.info;
    const name = title;
    // Since we share through a map link, this could be private as well
    const level = isPublic ? 'protected' : 'private';
    await this._saveFile(name, 'thumbnail.png', thumbnail, level);
    await this._saveFile(name, 'meta.json', {description}, level);
    const mapId = await this._saveFile(name, 'map.json', map, level).then(resp => resp && resp.key);
    // If public, url for sharing is created:
    if (isPublic) {
      // // Comment lines below to share url with loadParams:
      const config = {download: false, level, expires: EXPIRE_TIME_IN_SECONDS};
      try {
        const urlLink = await Storage.get(mapId, config);
        this._shareUrl = encodeURIComponent(urlLink || '');
        return {
          shareUrl: this.getShareUrl(true)
        };
      } catch (e) {
        AwsProvider._handleError('Saving failed', e);
      }
      // // Uncomment lines below to share url with loadParams:
      // this._loadParam =  {identityId, level, mapId};
      // return {shareUrl: this.getShareUrl(true)}
    }
    // if not public, map is saved and private map url is created
    this._loadParam = {...this._loadParam, level, mapId};
    return this._loadParam;
  }

  /**
   * Required!
   *
   * @param onCloudLogoutSuccess
   */
  async logout(onCloudLogoutSuccess) {
    try {
      await Auth.signOut().then(() => {
        onCloudLogoutSuccess();
      });
    } catch (e) {
      AwsProvider._handleError('Signing out failed', e);
    }
  }

  /**
   * Required!
   *
   * @returns {boolean}
   */
  hasPrivateStorage() {
    return PRIVATE_STORAGE_ENABLED;
  }

  /**
   * Required!
   *
   * @returns {boolean}
   */
  hasSharingUrl() {
    return SHARING_ENABLED;
  }

  getAccessToken() {
    let token = null;
    if (window.localStorage) {
      const key = `CognitoIdentityServiceProvider.${AWS_WEB_CLIENT_ID}`;
      const lastAuthUserKey = `${key}.LastAuthUser`;
      const lastAuthUser = window.localStorage.getItem(lastAuthUserKey);
      const tokenKey = `${key}.${lastAuthUser}.accessToken`;
      token = window.localStorage.getItem(tokenKey);
    }
    return Boolean(token);
  }

  getUserName() {
    if (window.localStorage) {
      const key = `CognitoIdentityServiceProvider.${AWS_WEB_CLIENT_ID}`;
      const lastAuthUser = window.localStorage.getItem(`${key}.LastAuthUser`);
      const userData = JSON.parse(window.localStorage.getItem(`${key}.${lastAuthUser}.userData`));
      return userData
        ? userData.UserAttributes.find(item => {
            return item.Name === 'email';
          }).Value
        : '';
    }
    return null;
  }

  getAccessTokenFromLocation() {}

  getShareUrl(fullUrl = true) {
    // Shared through direct map link:
    return fullUrl
      ? `${window.location.protocol}//${window.location.host}/${MAP_URI}${this._shareUrl}`
      : `/${MAP_URI}${this._shareUrl}`;

    // // To share map thorough loadParams in url:
    // const {level, mapId, identityId} = this._loadParam;
    // const mapLink = `demo/map/${PROVIDER_NAME}?level=${level}&mapId=${mapId}&identityId=${identityId}`;
    // return fullUrl
    //     ? `${window.location.protocol}//${window.location.host}/${mapLink}`
    //     : `/${mapLink}`;
  }

  getMapUrl(fullURL = true) {
    const {level, mapId} = this._loadParam;
    const mapLink = `demo/map/${PROVIDER_NAME}?level=${level}&mapId=${mapId}`;
    return fullURL
      ? `${window.location.protocol}//${window.location.host}/${mapLink}`
      : `/${mapLink}`;
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
    }).catch(e => {
      AwsProvider._handleError('Saving failed', e);
    });
  static _getFile(key, level, fileType, download) {
    return Storage.get(key, {
      level,
      download
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
        AwsProvider._handleError(`Map ${fileType} ${key} failed to load`, e);
      });
  }

  static _handleError(message, error) {
    throw new Error(`${message}, error message: 
      ${error && error.message}`);
  }

  static _decode_utf8(byteString) {
    return decodeURIComponent(escape(byteString));
  }

  static _encode_utf8(string) {
    return unescape(encodeURIComponent(string));
  }
}
