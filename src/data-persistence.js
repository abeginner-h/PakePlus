/**
 * 数据持久化模块
 * 处理本地存储、数据同步、备份恢复和协作功能
 */

class DataPersistenceManager {
    constructor(options = {}) {
        this.config = {
            storagePrefix: 'ai_pomodoro_',
            autoSaveInterval: 30000, // 30秒自动保存
            maxBackups: 10,
            syncEnabled: false,
            collaborationEnabled: false,
            ...options
        };

        this.storage = this.initializeStorage();
        this.syncQueue = [];
        this.isOnline = navigator.onLine;
        this.setupEventListeners();
        this.startAutoSave();
    }

    initializeStorage() {
        // 检查存储可用性
        try {
            localStorage.setItem('test', 'test');
            localStorage.removeItem('test');
            return {
                type: 'localStorage',
                available: true,
                quota: this.getStorageQuota()
            };
        } catch (e) {
            console.warn('localStorage不可用，使用内存存储');
            return {
                type: 'memory',
                available: false,
                data: new Map()
            };
        }
    }

    getStorageQuota() {
        try {
            return navigator.storage?.estimate?.() || Promise.resolve({ quota: 0, usage: 0 });
        } catch (e) {
            return Promise.resolve({ quota: 0, usage: 0 });
        }
    }

    setupEventListeners() {
        // 监听在线状态变化
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.processSyncQueue();
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
        });

        // 监听页面关闭，保存数据
        window.addEventListener('beforeunload', () => {
            this.saveAllData();
        });

        // 监听存储事件（跨标签页同步）
        window.addEventListener('storage', (event) => {
            if (event.key?.startsWith(this.config.storagePrefix)) {
                this.handleStorageChange(event);
            }
        });
    }

    // 核心存储方法
    save(key, data, options = {}) {
        const fullKey = this.config.storagePrefix + key;
        const saveData = {
            data,
            timestamp: new Date().toISOString(),
            version: options.version || 1,
            metadata: {
                userAgent: navigator.userAgent,
                url: window.location.href,
                sessionId: this.getSessionId()
            }
        };

        try {
            if (this.storage.type === 'localStorage') {
                const serialized = JSON.stringify(saveData);
                localStorage.setItem(fullKey, serialized);
                
                // 创建备份
                if (options.backup !== false) {
                    this.createBackup(key, saveData);
                }
                
                // 添加到同步队列
                if (this.config.syncEnabled && this.isOnline) {
                    this.addToSyncQueue(key, data, 'save');
                }
                
                return { success: true, size: serialized.length };
            } else {
                this.storage.data.set(fullKey, saveData);
                return { success: true, size: 0 };
            }
        } catch (error) {
            console.error(`保存数据失败 (${key}):`, error);
            
            // 尝试清理存储空间
            if (error.name === 'QuotaExceededError') {
                this.cleanupStorage();
                return this.save(key, data, { ...options, retry: true });
            }
            
            return { success: false, error: error.message };
        }
    }

    load(key, defaultValue = null) {
        const fullKey = this.config.storagePrefix + key;
        
        try {
            let data;
            if (this.storage.type === 'localStorage') {
                const stored = localStorage.getItem(fullKey);
                if (!stored) return defaultValue;
                data = JSON.parse(stored);
            } else {
                data = this.storage.data.get(fullKey);
                if (!data) return defaultValue;
            }
            
            // 数据验证和迁移
            const migrated = this.migrateData(key, data);
            if (migrated !== data) {
                this.save(key, migrated.data, { backup: false });
                return migrated.data;
            }
            
            return data.data;
        } catch (error) {
            console.error(`加载数据失败 (${key}):`, error);
            
            // 尝试从备份恢复
            return this.restoreFromBackup(key) || defaultValue;
        }
    }

    delete(key) {
        const fullKey = this.config.storagePrefix + key;
        
        try {
            if (this.storage.type === 'localStorage') {
                localStorage.removeItem(fullKey);
                this.deleteBackups(key);
            } else {
                this.storage.data.delete(fullKey);
            }
            
            // 添加删除操作到同步队列
            if (this.config.syncEnabled && this.isOnline) {
                this.addToSyncQueue(key, null, 'delete');
            }
            
            return { success: true };
        } catch (error) {
            console.error(`删除数据失败 (${key}):`, error);
            return { success: false, error: error.message };
        }
    }

    // 批量操作
    saveMultiple(dataMap, options = {}) {
        const results = {};
        const batch = options.batch || false;
        
        if (batch) {
            // 批量事务模式
            try {
                for (const [key, data] of Object.entries(dataMap)) {
                    results[key] = this.save(key, data, { ...options, backup: false });
                }
                
                // 创建批量备份
                this.createBatchBackup(dataMap, options);
                
                return { success: true, results };
            } catch (error) {
                // 回滚操作
                this.rollbackBatch(Object.keys(dataMap));
                return { success: false, error: error.message };
            }
        } else {
            // 独立保存模式
            for (const [key, data] of Object.entries(dataMap)) {
                results[key] = this.save(key, data, options);
            }
            return { success: true, results };
        }
    }

    loadMultiple(keys, defaultValue = null) {
        const results = {};
        
        for (const key of keys) {
            results[key] = this.load(key, defaultValue);
        }
        
        return results;
    }

    // 备份管理
    createBackup(key, data) {
        const backupKey = `${this.config.storagePrefix}backup_${key}_${Date.now()}`;
        
        try {
            if (this.storage.type === 'localStorage') {
                localStorage.setItem(backupKey, JSON.stringify(data));
                this.cleanupOldBackups(key);
            }
        } catch (error) {
            console.warn('创建备份失败:', error);
        }
    }

    createBatchBackup(dataMap, options) {
        const backupData = {
            timestamp: new Date().toISOString(),
            data: dataMap,
            options
        };
        
        const backupKey = `${this.config.storagePrefix}batch_backup_${Date.now()}`;
        
        try {
            if (this.storage.type === 'localStorage') {
                localStorage.setItem(backupKey, JSON.stringify(backupData));
            }
        } catch (error) {
            console.warn('创建批量备份失败:', error);
        }
    }

    restoreFromBackup(key) {
        try {
            const backupKeys = this.getBackupKeys(key);
            if (backupKeys.length === 0) return null;
            
            // 尝试最新的备份
            const latestBackup = backupKeys[0];
            const backupData = localStorage.getItem(latestBackup);
            
            if (backupData) {
                const parsed = JSON.parse(backupData);
                console.log(`从备份恢复数据: ${key}`);
                return parsed.data;
            }
        } catch (error) {
            console.error('备份恢复失败:', error);
        }
        
        return null;
    }

    getBackupKeys(key) {
        const pattern = `${this.config.storagePrefix}backup_${key}_`;
        const keys = [];
        
        if (this.storage.type === 'localStorage') {
            for (let i = 0; i < localStorage.length; i++) {
                const storageKey = localStorage.key(i);
                if (storageKey?.startsWith(pattern)) {
                    keys.push(storageKey);
                }
            }
        }
        
        // 按时间戳排序（最新的在前）
        return keys.sort((a, b) => {
            const timeA = parseInt(a.split('_').pop());
            const timeB = parseInt(b.split('_').pop());
            return timeB - timeA;
        });
    }

    cleanupOldBackups(key) {
        const backupKeys = this.getBackupKeys(key);
        
        // 保留最近的备份
        if (backupKeys.length > this.config.maxBackups) {
            const toDelete = backupKeys.slice(this.config.maxBackups);
            for (const backupKey of toDelete) {
                localStorage.removeItem(backupKey);
            }
        }
    }

    deleteBackups(key) {
        const backupKeys = this.getBackupKeys(key);
        for (const backupKey of backupKeys) {
            localStorage.removeItem(backupKey);
        }
    }

    // 存储空间管理
    cleanupStorage() {
        try {
            const usage = this.getStorageUsage();
            console.log('开始清理存储空间...', usage);
            
            // 1. 清理过期数据
            this.cleanupExpiredData();
            
            // 2. 清理多余备份
            this.cleanupAllBackups();
            
            // 3. 压缩数据
            this.compressData();
            
            const newUsage = this.getStorageUsage();
            console.log('存储清理完成', newUsage);
            
        } catch (error) {
            console.error('存储清理失败:', error);
        }
    }

    getStorageUsage() {
        if (this.storage.type !== 'localStorage') return { used: 0, total: 0 };
        
        let totalSize = 0;
        const itemSizes = {};
        
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(this.config.storagePrefix)) {
                const value = localStorage.getItem(key);
                const size = value ? value.length * 2 : 0; // 估算字节大小
                itemSizes[key] = size;
                totalSize += size;
            }
        }
        
        return {
            used: totalSize,
            items: Object.keys(itemSizes).length,
            breakdown: itemSizes
        };
    }

    cleanupExpiredData() {
        const now = new Date();
        const expiredKeys = [];
        
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key?.startsWith(this.config.storagePrefix)) continue;
            
            try {
                const data = JSON.parse(localStorage.getItem(key));
                if (data.expiry && new Date(data.expiry) < now) {
                    expiredKeys.push(key);
                }
            } catch (error) {
                // 无法解析的数据也删除
                expiredKeys.push(key);
            }
        }
        
        for (const key of expiredKeys) {
            localStorage.removeItem(key);
        }
        
        console.log(`清理了${expiredKeys.length}个过期项目`);
    }

    cleanupAllBackups() {
        const allKeys = Object.keys(localStorage);
        const backupKeys = allKeys.filter(key => 
            key.startsWith(this.config.storagePrefix) && key.includes('backup_')
        );
        
        // 按类型分组备份
        const backupGroups = {};
        for (const key of backupKeys) {
            const parts = key.split('_');
            const dataKey = parts[2]; // 提取原始数据键
            if (!backupGroups[dataKey]) {
                backupGroups[dataKey] = [];
            }
            backupGroups[dataKey].push(key);
        }
        
        // 为每个数据键保留最新的备份
        let cleanedCount = 0;
        for (const [dataKey, keys] of Object.entries(backupGroups)) {
            const sortedKeys = keys.sort((a, b) => {
                const timeA = parseInt(a.split('_').pop());
                const timeB = parseInt(b.split('_').pop());
                return timeB - timeA;
            });
            
            // 删除多余的备份
            const toDelete = sortedKeys.slice(2); // 保留最新的2个
            for (const key of toDelete) {
                localStorage.removeItem(key);
                cleanedCount++;
            }
        }
        
        console.log(`清理了${cleanedCount}个旧备份`);
    }

    compressData() {
        // 实现数据压缩逻辑
        // 这里可以使用 LZ-string 或其他压缩库
        console.log('数据压缩功能待实现');
    }

    // 数据迁移
    migrateData(key, data) {
        const currentVersion = 1;
        const dataVersion = data.version || 0;
        
        if (dataVersion >= currentVersion) {
            return data;
        }
        
        console.log(`迁移数据: ${key} (v${dataVersion} -> v${currentVersion})`);
        
        let migrated = { ...data };
        
        // 版本迁移逻辑
        if (dataVersion < 1) {
            migrated = this.migrateToV1(migrated);
        }
        
        migrated.version = currentVersion;
        return migrated;
    }

    migrateToV1(data) {
        // v0 -> v1 迁移逻辑
        if (data.data && Array.isArray(data.data)) {
            // 为任务添加新字段
            data.data = data.data.map(task => ({
                ...task,
                category: task.category || 'work',
                tags: task.tags || [],
                complexity: task.complexity || 'medium',
                aiGenerated: task.aiGenerated || false
            }));
        }
        
        return data;
    }

    // 同步功能
    addToSyncQueue(key, data, operation) {
        if (!this.config.syncEnabled) return;
        
        this.syncQueue.push({
            key,
            data,
            operation,
            timestamp: new Date().toISOString(),
            attempts: 0
        });
        
        if (this.isOnline) {
            this.processSyncQueue();
        }
    }

    async processSyncQueue() {
        if (!this.config.syncEnabled || this.syncQueue.length === 0) return;
        
        console.log(`处理同步队列: ${this.syncQueue.length} 项目`);
        
        while (this.syncQueue.length > 0 && this.isOnline) {
            const item = this.syncQueue.shift();
            
            try {
                await this.syncItem(item);
                console.log(`同步成功: ${item.key}`);
            } catch (error) {
                console.error(`同步失败: ${item.key}`, error);
                
                item.attempts++;
                if (item.attempts < 3) {
                    // 重新加入队列重试
                    this.syncQueue.push(item);
                }
            }
        }
    }

    async syncItem(item) {
        // 这里实现与服务器的同步逻辑
        // 可以使用 WebSocket、Server-Sent Events 或 REST API
        
        const syncData = {
            key: item.key,
            data: item.data,
            operation: item.operation,
            timestamp: item.timestamp,
            deviceId: this.getDeviceId(),
            sessionId: this.getSessionId()
        };
        
        // 模拟同步请求
        console.log('同步数据:', syncData);
        
        // 实际实现中，这里应该是真实的API调用
        // const response = await fetch('/api/sync', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify(syncData)
        // });
        
        return Promise.resolve(); // 模拟成功
    }

    // 协作功能
    enableCollaboration(options = {}) {
        this.config.collaborationEnabled = true;
        this.collaborationConfig = {
            roomId: options.roomId || this.generateRoomId(),
            userId: options.userId || this.getUserId(),
            permissions: options.permissions || ['read', 'write'],
            ...options
        };
        
        this.setupCollaborationSync();
    }

    setupCollaborationSync() {
        // 设置实时协作同步
        // 可以使用 WebSocket、WebRTC 或其他实时通信技术
        
        console.log('设置协作同步:', this.collaborationConfig);
        
        // 模拟协作事件监听
        this.collaborationListeners = {
            onTaskUpdate: (data) => this.handleCollaborativeUpdate(data),
            onUserJoin: (user) => this.handleUserJoin(user),
            onUserLeave: (user) => this.handleUserLeave(user)
        };
    }

    handleCollaborativeUpdate(updateData) {
        console.log('收到协作更新:', updateData);
        
        // 处理远程数据更新
        if (updateData.key && updateData.data) {
            this.save(updateData.key, updateData.data, { 
                backup: true, 
                skipSync: true // 避免循环同步
            });
            
            // 触发UI更新事件
            this.dispatchCollaborationEvent('dataUpdate', updateData);
        }
    }

    handleUserJoin(user) {
        console.log('用户加入协作:', user);
        this.dispatchCollaborationEvent('userJoin', user);
    }

    handleUserLeave(user) {
        console.log('用户离开协作:', user);
        this.dispatchCollaborationEvent('userLeave', user);
    }

    dispatchCollaborationEvent(type, data) {
        const event = new CustomEvent('collaboration', {
            detail: { type, data }
        });
        window.dispatchEvent(event);
    }

    shareData(key, permissions = ['read']) {
        if (!this.config.collaborationEnabled) {
            throw new Error('协作功能未启用');
        }
        
        const data = this.load(key);
        if (!data) {
            throw new Error('数据不存在');
        }
        
        const shareToken = this.generateShareToken();
        const shareData = {
            token: shareToken,
            key,
            data,
            permissions,
            creator: this.getUserId(),
            created: new Date().toISOString(),
            expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7天后过期
        };
        
        // 保存共享信息
        this.save(`share_${shareToken}`, shareData);
        
        return {
            shareUrl: `${window.location.origin}${window.location.pathname}?share=${shareToken}`,
            token: shareToken,
            expires: shareData.expires
        };
    }

    // 自动保存
    startAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
        }
        
        this.autoSaveTimer = setInterval(() => {
            this.autoSaveData();
        }, this.config.autoSaveInterval);
    }

    autoSaveData() {
        // 这里可以实现自动保存逻辑
        // 比如检查需要保存的数据并自动保存
        console.log('执行自动保存...');
        
        const event = new CustomEvent('autoSave', {
            detail: { timestamp: new Date().toISOString() }
        });
        window.dispatchEvent(event);
    }

    saveAllData() {
        // 保存所有待保存的数据
        console.log('保存所有数据...');
        
        const event = new CustomEvent('saveAll', {
            detail: { timestamp: new Date().toISOString() }
        });
        window.dispatchEvent(event);
    }

    // 跨标签页同步
    handleStorageChange(event) {
        if (event.key.startsWith(this.config.storagePrefix)) {
            const key = event.key.replace(this.config.storagePrefix, '');
            const newValue = event.newValue ? JSON.parse(event.newValue) : null;
            
            console.log('检测到跨标签页数据变化:', key);
            
            const changeEvent = new CustomEvent('dataSync', {
                detail: { 
                    key, 
                    data: newValue?.data, 
                    source: 'external' 
                }
            });
            window.dispatchEvent(changeEvent);
        }
    }

    // 工具方法
    getSessionId() {
        if (!this._sessionId) {
            this._sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        }
        return this._sessionId;
    }

    getDeviceId() {
        let deviceId = localStorage.getItem('device_id');
        if (!deviceId) {
            deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('device_id', deviceId);
        }
        return deviceId;
    }

    getUserId() {
        return this.load('userId') || 'anonymous_' + this.getDeviceId();
    }

    generateRoomId() {
        return 'room_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    generateShareToken() {
        return 'share_' + Date.now() + '_' + Math.random().toString(36).substr(2, 16);
    }

    rollbackBatch(keys) {
        console.log('回滚批量操作:', keys);
        // 实现回滚逻辑
        for (const key of keys) {
            this.restoreFromBackup(key);
        }
    }

    // 导出和导入
    exportData(keys = null) {
        const exportData = {
            version: 1,
            timestamp: new Date().toISOString(),
            source: 'ai-pomodoro-timer',
            data: {}
        };
        
        const keysToExport = keys || this.getAllDataKeys();
        
        for (const key of keysToExport) {
            const data = this.load(key);
            if (data !== null) {
                exportData.data[key] = data;
            }
        }
        
        return exportData;
    }

    importData(importData, options = {}) {
        const { merge = false, validate = true } = options;
        
        if (validate && !this.validateImportData(importData)) {
            throw new Error('导入数据格式无效');
        }
        
        const results = {};
        
        for (const [key, data] of Object.entries(importData.data)) {
            try {
                if (!merge) {
                    // 完全替换
                    results[key] = this.save(key, data);
                } else {
                    // 合并数据
                    const existing = this.load(key, {});
                    const merged = this.mergeData(existing, data);
                    results[key] = this.save(key, merged);
                }
            } catch (error) {
                results[key] = { success: false, error: error.message };
            }
        }
        
        return results;
    }

    validateImportData(data) {
        return data && 
               typeof data === 'object' && 
               data.version && 
               data.data && 
               typeof data.data === 'object';
    }

    mergeData(existing, imported) {
        if (Array.isArray(existing) && Array.isArray(imported)) {
            // 合并数组，去重
            const merged = [...existing];
            for (const item of imported) {
                if (!merged.some(existing => existing.id === item.id)) {
                    merged.push(item);
                }
            }
            return merged;
        } else if (typeof existing === 'object' && typeof imported === 'object') {
            // 合并对象
            return { ...existing, ...imported };
        } else {
            // 其他情况直接使用导入的数据
            return imported;
        }
    }

    getAllDataKeys() {
        const keys = [];
        
        if (this.storage.type === 'localStorage') {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key?.startsWith(this.config.storagePrefix) && 
                    !key.includes('backup_') && 
                    !key.includes('share_')) {
                    keys.push(key.replace(this.config.storagePrefix, ''));
                }
            }
        } else {
            for (const [key] of this.storage.data.entries()) {
                if (key.startsWith(this.config.storagePrefix)) {
                    keys.push(key.replace(this.config.storagePrefix, ''));
                }
            }
        }
        
        return keys;
    }

    // 清理方法
    destroy() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
        }
        
        // 清理事件监听器
        window.removeEventListener('online', this.onlineHandler);
        window.removeEventListener('offline', this.offlineHandler);
        window.removeEventListener('beforeunload', this.beforeUnloadHandler);
        window.removeEventListener('storage', this.storageHandler);
        
        console.log('数据持久化管理器已销毁');
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DataPersistenceManager;
} else if (typeof window !== 'undefined') {
    window.DataPersistenceManager = DataPersistenceManager;
}