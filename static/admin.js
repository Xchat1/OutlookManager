// 账号管理页面JavaScript

class AdminManager {
    constructor() {
        this.isAuthenticated = false;
        this.token = '';
        // 分页与搜索状态
        this.page = 1;
        this.pageSize = 10;
        this.total = 0;
        this.query = '';
        this.init();
    }

    init() {
        this.bindEvents();
        this.checkStoredAuth();
    }

    bindEvents() {
        // 登录表单
        document.getElementById('loginForm').addEventListener('submit', this.handleLogin.bind(this));
        
        // 刷新账号列表
        document.getElementById('refreshAccountsBtn').addEventListener('click', () => {
            this.page = 1;
            this.loadAccounts();
        });

        // 搜索
        const searchInput = document.getElementById('accountSearchInput');
        const searchBtn = document.getElementById('searchAccountsBtn');
        if (searchBtn) {
            searchBtn.addEventListener('click', () => {
                this.query = searchInput.value.trim();
                this.page = 1;
                this.loadAccounts();
            });
        }
        if (searchInput) {
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.query = searchInput.value.trim();
                    this.page = 1;
                    this.loadAccounts();
                }
            });
        }

        // 分页
        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                if (this.page > 1) {
                    this.page -= 1;
                    this.loadAccounts();
                }
            });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                const maxPage = Math.max(1, Math.ceil(this.total / this.pageSize));
                if (this.page < maxPage) {
                    this.page += 1;
                    this.loadAccounts();
                }
            });
        }
        
        // 导入相关（存在才绑定）
        const executeImportBtn = document.getElementById('executeImportBtn');
        if (executeImportBtn) {
            executeImportBtn.addEventListener('click', this.executeImport.bind(this));
        }
        const clearImportBtn = document.getElementById('clearImportBtn');
        if (clearImportBtn) {
            clearImportBtn.addEventListener('click', this.clearImport.bind(this));
        }
        
        // 导出
        document.getElementById('exportDataBtn').addEventListener('click', this.exportData.bind(this));
        
        // 退出登录
        document.getElementById('logoutBtn').addEventListener('click', this.logout.bind(this));
        
        // 单页：不使用tabs，直接加载列表
        setTimeout(() => this.loadAccounts(), 100);

        // 打开导入对话框
        const openImportBtn = document.getElementById('openImportModalBtn');
        if (openImportBtn) {
            openImportBtn.addEventListener('click', () => {
                const modal = new bootstrap.Modal(document.getElementById('importModal'));
                modal.show();
            });
        }

        // OAuth 添加账号
        const oauthBtn = document.getElementById('oauthAddAccountBtn');
        if (oauthBtn) {
            oauthBtn.addEventListener('click', this.startOAuth.bind(this));
        }

        // 监听 OAuth 回调消息
        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'oauth_success') {
                this.showToast(`✅ 账号 ${e.data.email} 已成功添加`, 'success');
                this.loadAccounts();
            }
        });
    }

    // ==================== OAuth 添加账号 ====================

    async startOAuth() {
        try {
            const resp = await fetch('/oauth/start');
            const data = await resp.json();
            if (!data.url) throw new Error('未获取到授权 URL');

            const w = 520, h = 640;
            const left = Math.round(window.screenX + (window.outerWidth - w) / 2);
            const top  = Math.round(window.screenY + (window.outerHeight - h) / 2);
            const popup = window.open(
                data.url,
                'oauth_popup',
                `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes`
            );

            if (!popup) {
                this.showError('弹窗被浏览器拦截，请允许弹窗后重试');
                return;
            }

            this.showToast('已打开授权窗口，请在弹窗中完成登录', 'info');
        } catch (e) {
            this.showError('启动 OAuth 失败: ' + e.message);
        }
    }

    // ==================== Toast 提示 ====================

    showToast(message, type = 'info', duration = 4000) {
        const existing = document.querySelector('.oauth-toast');
        if (existing) existing.remove();

        const icons = { success: '✅', error: '❌', info: 'ℹ️' };
        const toast = document.createElement('div');
        toast.className = `oauth-toast ${type}`;
        toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    checkStoredAuth() {
        // 检查是否有保存的认证信息（仅在当前会话有效）
        const storedToken = sessionStorage.getItem('admin_token');
        if (storedToken) {
            this.token = storedToken;
            this.showManagement();
        }
    }

    async handleLogin(event) {
        event.preventDefault();
        
        const tokenInput = document.getElementById('tokenInput');
        const enteredToken = tokenInput.value.trim();
        
        if (!enteredToken) {
            this.showError('请输入管理令牌');
            return;
        }

        try {
            // 验证令牌
            const isValid = await this.verifyToken(enteredToken);
            
            if (isValid) {
                this.token = enteredToken;
                this.isAuthenticated = true;
                
                // 保存到会话存储
                sessionStorage.setItem('admin_token', enteredToken);
                
                this.showManagement();
                this.showSuccess('登录成功');
            } else {
                this.showError('令牌验证失败，请检查输入的令牌是否正确');
            }
        } catch (error) {
            console.error('登录失败:', error);
            this.showError('登录失败: ' + error.message);
        }
    }

    async verifyToken(token) {
        try {
            // 发送验证请求到后端
            const response = await fetch('/api/admin/verify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ token: token })
            });

            if (response.ok) {
                const result = await response.json();
                return result.success;
            }
            return false;
        } catch (error) {
            console.error('令牌验证错误:', error);
            return false;
        }
    }

    showManagement() {
        document.getElementById('loginSection').style.display = 'none';
        document.getElementById('managementSection').style.display = 'block';
        
        // 自动加载账号列表
        this.loadAccounts();
    }

    async loadAccounts() {
        const accountsList = document.getElementById('accountsList');
        
        // 显示加载状态（表格内）
        const tbodyLoading = document.getElementById('accountsTbody');
        if (tbodyLoading) {
            tbodyLoading.innerHTML = `
                <tr>
                    <td colspan="3" class="text-center py-4">
                        <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
                        <div class="mt-2 small text-muted">正在加载账号列表...</div>
                    </td>
                </tr>
            `;
        }

        try {
            const params = new URLSearchParams();
            params.set('page', String(this.page));
            params.set('page_size', String(this.pageSize));
            if (this.query) params.set('q', this.query);
            const response = await fetch(`/api/accounts/paged?${params.toString()}`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    const items = (result.data && result.data.items) ? result.data.items : [];
                    this.total = (result.data && typeof result.data.total === 'number') ? result.data.total : items.length;
                    this.page = (result.data && typeof result.data.page === 'number') ? result.data.page : this.page;
                    this.pageSize = (result.data && typeof result.data.page_size === 'number') ? result.data.page_size : this.pageSize;
                    this.renderAccounts(items);
                    this.renderPager();
                } else {
                    throw new Error(result.message);
                }
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.error('加载账号列表失败:', error);
            accountsList.innerHTML = `
                <div class="text-center py-4 text-danger">
                    <i class="bi bi-exclamation-triangle display-4"></i>
                    <div class="mt-2">加载失败: ${error.message}</div>
                    <button class="btn btn-outline-primary btn-sm mt-2" onclick="adminManager.loadAccounts()">
                        <i class="bi bi-arrow-clockwise me-1"></i>重试
                    </button>
                </div>
            `;
        }
    }

    async renderAccounts(accounts) {
        const tbody = document.getElementById('accountsTbody');
        if (!tbody) return;
        
        if (accounts.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="3" class="text-center py-4 text-muted">
                        <i class="bi bi-inbox"></i>
                        <div class="mt-2 small">暂无账号数据</div>
                    </td>
                </tr>
            `;
            return;
        }

        // 获取所有账户的标签信息
        const accountsWithTags = await this.loadAccountsWithTags();

        const accountsHtml = accounts.map((account, index) => {
            const tags = accountsWithTags[account.email] || [];
            const tagsHtml = tags.length > 0 ? 
                tags.map(tag => `<span class="badge bg-secondary me-1 mb-1">${this.escapeHtml(tag)}</span>`).join('') : 
                '<span class="text-muted small">无标签</span>';
            
            return `
                <tr>
                    <td class="small"><i class="bi bi-envelope me-1"></i>${account.email}</td>
                    <td>${tagsHtml}</td>
                    <td class="text-end">
                        <div class="btn-group btn-group-sm" role="group">
                            <button class="btn btn-outline-secondary btn-sm" 
                                    onclick="adminManager.showTagManagementDialog('${account.email}')"
                                    title="管理标签">
                                <i class="bi bi-tags"></i>
                            </button>
                            <button class="btn btn-outline-danger btn-sm"
                                    onclick="adminManager.deleteAccount('${account.email}')"
                                    title="删除账号">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        tbody.innerHTML = accountsHtml;
    }

    // ==================== 删除账号 ====================

    async deleteAccount(email) {
        if (!confirm(`确定要删除账号 ${email} 吗？此操作不可恢复。`)) return;
        try {
            const resp = await fetch(`/api/account/${encodeURIComponent(email)}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            const result = await resp.json();
            if (result.success) {
                this.showToast(`账号 ${email} 已删除`, 'success');
                this.loadAccounts();
            } else {
                this.showError(result.message || '删除失败');
            }
        } catch (e) {
            this.showError('删除失败: ' + e.message);
        }
    }

    clearImport() {
        document.getElementById('importTextarea').value = '';
        document.getElementById('mergeMode').value = 'update';
        this.showSuccess('已清空导入内容');
    }

    async executeImport() {
        const textarea = document.getElementById('importTextarea');
        const mergeMode = document.getElementById('mergeMode');
        
        const importText = textarea.value.trim();
        if (!importText) {
            this.showError('请输入要导入的账户数据');
            return;
        }

        try {
            // 解析文本
            const parseResponse = await fetch('/api/parse-import-text', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ text: importText })
            });

            if (!parseResponse.ok) {
                throw new Error(`解析失败: HTTP ${parseResponse.status}`);
            }

            const parseResult = await parseResponse.json();
            if (!parseResult.success) {
                throw new Error(parseResult.message);
            }

            // 执行导入
            const importResponse = await fetch('/api/import', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({
                    accounts: parseResult.data.accounts,  // 只提取accounts数组
                    merge_mode: mergeMode.value
                })
            });

            if (!importResponse.ok) {
                throw new Error(`导入失败: HTTP ${importResponse.status}`);
            }

            const importResult = await importResponse.json();
            
            if (importResult.success) {
                this.showSuccess(`导入完成! 新增: ${importResult.added_count}, 更新: ${importResult.updated_count}, 跳过: ${importResult.skipped_count}`);
                // 清空导入内容
                document.getElementById('importTextarea').value = '';
                this.loadAccounts(); // 刷新账号列表
            } else {
                this.showError(`导入失败: ${importResult.message}`);
            }

        } catch (error) {
            console.error('导入失败:', error);
            this.showError(`导入失败: ${error.message}`);
        }
    }

    async exportData() {
        try {
            const response = await fetch('/api/export');

            if (response.ok) {
                // 直接获取文本内容
                const content = await response.text();
                
                // 从响应头获取文件名
                const contentDisposition = response.headers.get('Content-Disposition');
                let filename = 'outlook_accounts_config.txt';
                if (contentDisposition) {
                    const match = contentDisposition.match(/filename=(.+)/);
                    if (match) {
                        filename = match[1];
                    }
                }
                
                // 下载文件
                this.downloadTextFile(content, filename);
                this.showSuccess('数据导出成功');
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.error('导出失败:', error);
            this.showError(`导出失败: ${error.message}`);
        }
    }

    downloadTextFile(content, filename) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }

    logout() {
        this.isAuthenticated = false;
        this.token = '';
        sessionStorage.removeItem('admin_token');
        
        document.getElementById('managementSection').style.display = 'none';
        document.getElementById('loginSection').style.display = 'block';
        
        // 清空表单
        document.getElementById('tokenInput').value = '';
        
        this.showSuccess('已安全退出管理');
    }

    showSuccess(message) {
        document.getElementById('successMessage').textContent = message;
        const modal = new bootstrap.Modal(document.getElementById('successModal'));
        modal.show();
    }

    showError(message) {
        document.getElementById('errorMessage').textContent = message;
        const modal = new bootstrap.Modal(document.getElementById('errorModal'));
        modal.show();
    }

    // ==================== 标签管理功能 ====================
    
    async loadAccountsWithTags() {
        try {
            const response = await fetch('/api/accounts/tags', {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    return result.data.accounts || {};
                }
            }
        } catch (error) {
            console.error('加载账户标签失败:', error);
        }
        return {};
    }
    
    async showTagManagementDialog(email) {
        // 显示标签管理对话框
        const modal = new bootstrap.Modal(document.getElementById('tagManagementModal'));
        const modalTitle = document.getElementById('tagManagementModalTitle');
        const tagInput = document.getElementById('tagManagementInput');
        const currentTagsDisplay = document.getElementById('tagManagementCurrentTags');
        
        modalTitle.textContent = `管理标签 - ${email}`;
        
        // 加载当前标签
        try {
            const response = await fetch(`/api/account/${encodeURIComponent(email)}/tags`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    const tags = result.data.tags || [];
                    tagInput.value = tags.join(',');
                    
                    if (tags.length > 0) {
                        const tagsHtml = tags.map(tag => 
                            `<span class="badge bg-secondary me-1">${this.escapeHtml(tag)}</span>`
                        ).join('');
                        currentTagsDisplay.innerHTML = tagsHtml;
                    } else {
                        currentTagsDisplay.innerHTML = '<span class="text-muted">暂无标签</span>';
                    }
                }
            }
        } catch (error) {
            console.error('加载账户标签失败:', error);
        }
        
        // 设置保存按钮事件
        const saveBtn = document.getElementById('tagManagementSaveBtn');
        saveBtn.onclick = () => this.saveAccountTagsFromDialog(email);
        
        modal.show();
    }
    
    async saveAccountTagsFromDialog(email) {
        const tagInput = document.getElementById('tagManagementInput');
        const tagsText = tagInput.value.trim();
        const tags = tagsText ? tagsText.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
        
        try {
            const response = await fetch(`/api/account/${encodeURIComponent(email)}/tags`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ email: email, tags: tags })
            });
            
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.showSuccess('标签保存成功');
                    // 关闭对话框
                    const modal = bootstrap.Modal.getInstance(document.getElementById('tagManagementModal'));
                    modal.hide();
                    // 刷新账户列表
                    this.loadAccounts();
                } else {
                    this.showError('保存失败: ' + result.message);
                }
            } else {
                this.showError(`保存失败: HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('保存标签失败:', error);
            this.showError('保存标签失败: ' + error.message);
        }
    }
    
    async loadAllTags() {
        const allTagsList = document.getElementById('allTagsList');
        
        allTagsList.innerHTML = `
            <div class="text-center py-3">
                <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
                <div class="mt-2 small">加载中...</div>
            </div>
        `;
        
        try {
            const response = await fetch('/api/accounts/tags', {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.renderAllTags(result.data.tags || []);
                } else {
                    throw new Error(result.message);
                }
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('加载标签失败:', error);
            allTagsList.innerHTML = `
                <div class="text-center py-3 text-danger">
                    <i class="bi bi-exclamation-triangle"></i>
                    <div class="mt-2 small">加载失败: ${error.message}</div>
                </div>
            `;
        }
    }
    
    renderAllTags(tags) {
        const allTagsList = document.getElementById('allTagsList');
        
        if (tags.length === 0) {
            allTagsList.innerHTML = `
                <div class="text-center py-3 text-muted">
                    <i class="bi bi-tags"></i>
                    <div class="mt-2 small">暂无标签</div>
                </div>
            `;
            return;
        }
        
        const tagsHtml = tags.map(tag => `
            <span class="badge bg-primary me-1 mb-1">${this.escapeHtml(tag)}</span>
        `).join('');
        
        allTagsList.innerHTML = `
            <div class="mb-2">
                <small class="text-muted">共 ${tags.length} 个标签：</small>
            </div>
            <div>${tagsHtml}</div>
        `;
    }
    
    async loadAccountsForTags() {
        const tagAccountSelect = document.getElementById('tagAccountSelect');
        
        try {
            const response = await fetch('/api/accounts');
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    tagAccountSelect.innerHTML = '<option value="">请选择账户...</option>';
                    result.data.forEach(account => {
                        const option = document.createElement('option');
                        option.value = account.email;
                        option.textContent = account.email;
                        tagAccountSelect.appendChild(option);
                    });
                }
            }
        } catch (error) {
            console.error('加载账户列表失败:', error);
        }
    }
    
    async loadAccountTags() {
        const tagAccountSelect = document.getElementById('tagAccountSelect');
        const accountTagsInput = document.getElementById('accountTagsInput');
        const currentAccountTags = document.getElementById('currentAccountTags');
        const currentTagsDisplay = document.getElementById('currentTagsDisplay');
        
        const selectedEmail = tagAccountSelect.value;
        if (!selectedEmail) {
            accountTagsInput.value = '';
            currentAccountTags.style.display = 'none';
            return;
        }
        
        try {
            const response = await fetch(`/api/account/${encodeURIComponent(selectedEmail)}/tags`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    const tags = result.data.tags || [];
                    accountTagsInput.value = tags.join(',');
                    
                    if (tags.length > 0) {
                        const tagsHtml = tags.map(tag => 
                            `<span class="badge bg-secondary me-1">${this.escapeHtml(tag)}</span>`
                        ).join('');
                        currentTagsDisplay.innerHTML = tagsHtml;
                        currentAccountTags.style.display = 'block';
                    } else {
                        currentAccountTags.style.display = 'none';
                    }
                }
            }
        } catch (error) {
            console.error('加载账户标签失败:', error);
            this.showError('加载账户标签失败: ' + error.message);
        }
    }
    
    async saveAccountTags() {
        const tagAccountSelect = document.getElementById('tagAccountSelect');
        const accountTagsInput = document.getElementById('accountTagsInput');
        
        const selectedEmail = tagAccountSelect.value;
        if (!selectedEmail) {
            this.showError('请先选择账户');
            return;
        }
        
        const tagsText = accountTagsInput.value.trim();
        const tags = tagsText ? tagsText.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
        
        try {
            const response = await fetch(`/api/account/${encodeURIComponent(selectedEmail)}/tags`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ email: selectedEmail, tags: tags })
            });
            
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.showSuccess('标签保存成功');
                    this.loadAccountTags(); // 刷新显示
                    this.loadAllTags(); // 刷新所有标签列表
                } else {
                    this.showError('保存失败: ' + result.message);
                }
            } else {
                this.showError(`保存失败: HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('保存标签失败:', error);
            this.showError('保存标签失败: ' + error.message);
        }
    }
    
    clearAccountTags() {
        document.getElementById('accountTagsInput').value = '';
        document.getElementById('currentAccountTags').style.display = 'none';
    }
    
    // ==================== 分页信息渲染 ====================
    renderPager() {
        const info = document.getElementById('accountsPagerInfo');
        if (!info) return;
        const maxPage = Math.max(1, Math.ceil(this.total / this.pageSize));
        info.textContent = `第 ${this.page} / ${maxPage} 页，共 ${this.total} 条`;
        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');
        if (prevBtn) prevBtn.disabled = this.page <= 1;
        if (nextBtn) nextBtn.disabled = this.page >= maxPage;
    }
    
    // ==================== 辅助方法 ====================
    
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    formatDate(dateString) {
        if (!dateString) return '未知时间';
        
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) {
                return dateString;
            }
            
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
            
            const timeDiff = today.getTime() - messageDate.getTime();
            const daysDiff = Math.floor(timeDiff / (1000 * 3600 * 24));
            
            if (daysDiff === 0) {
                return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            } else if (daysDiff === 1) {
                return '昨天';
            } else if (daysDiff < 7) {
                return `${daysDiff}天前`;
            } else {
                return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
            }
        } catch (error) {
            console.error('Date formatting error:', error);
            return dateString;
        }
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    window.adminManager = new AdminManager();
});