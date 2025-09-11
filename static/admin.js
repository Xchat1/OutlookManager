// 账号管理页面JavaScript

class AdminManager {
    constructor() {
        this.isAuthenticated = false;
        this.token = '';
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
        document.getElementById('refreshAccountsBtn').addEventListener('click', this.loadAccounts.bind(this));
        
        // 导入相关
        document.getElementById('executeImportBtn').addEventListener('click', this.executeImport.bind(this));
        document.getElementById('clearImportBtn').addEventListener('click', this.clearImport.bind(this));
        
        // 导出
        document.getElementById('exportDataBtn').addEventListener('click', this.exportData.bind(this));
        
        // 退出登录
        document.getElementById('logoutBtn').addEventListener('click', this.logout.bind(this));
        
        // 选项卡切换时刷新数据
        document.getElementById('accounts-tab').addEventListener('click', () => {
            setTimeout(() => this.loadAccounts(), 100);
        });
        
        // 标签管理相关事件
        const refreshTagsBtn = document.getElementById('refreshTagsBtn');
        if (refreshTagsBtn) {
            refreshTagsBtn.addEventListener('click', this.loadAllTags.bind(this));
        }
        
        const tagAccountSelect = document.getElementById('tagAccountSelect');
        if (tagAccountSelect) {
            tagAccountSelect.addEventListener('change', this.loadAccountTags.bind(this));
        }
        
        const saveTagsBtn = document.getElementById('saveTagsBtn');
        if (saveTagsBtn) {
            saveTagsBtn.addEventListener('click', this.saveAccountTags.bind(this));
        }
        
        const clearTagsBtn = document.getElementById('clearTagsBtn');
        if (clearTagsBtn) {
            clearTagsBtn.addEventListener('click', this.clearAccountTags.bind(this));
        }
        
        // 系统配置相关事件
        const saveConfigBtn = document.getElementById('saveConfigBtn');
        if (saveConfigBtn) {
            saveConfigBtn.addEventListener('click', this.saveSystemConfig.bind(this));
        }
        
        const resetConfigBtn = document.getElementById('resetConfigBtn');
        if (resetConfigBtn) {
            resetConfigBtn.addEventListener('click', this.resetSystemConfig.bind(this));
        }
        
        const testEmailBtn = document.getElementById('testEmailBtn');
        if (testEmailBtn) {
            testEmailBtn.addEventListener('click', this.showTestEmailModal.bind(this));
        }
        
        // 测试邮件相关事件
        const testEmailForm = document.getElementById('testEmailForm');
        if (testEmailForm) {
            testEmailForm.addEventListener('submit', this.executeEmailTest.bind(this));
        }
        
        // 选项卡切换时加载相应数据
        document.getElementById('tags-tab').addEventListener('click', () => {
            setTimeout(() => {
                this.loadAllTags();
                this.loadAccountsForTags();
            }, 100);
        });
        
        document.getElementById('config-tab').addEventListener('click', () => {
            setTimeout(() => {
                this.loadSystemConfig();
            }, 100);
        });
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
        const accountCount = document.getElementById('accountCount');
        
        // 显示加载状态
        accountsList.innerHTML = `
            <div class="text-center py-4">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">加载中...</span>
                </div>
                <div class="mt-2">正在加载账号列表...</div>
            </div>
        `;

        try {
            const response = await fetch('/api/accounts', {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.renderAccounts(result.data);
                    accountCount.textContent = result.data.length;
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
            accountCount.textContent = '0';
        }
    }

    async renderAccounts(accounts) {
        const accountsList = document.getElementById('accountsList');
        
        if (accounts.length === 0) {
            accountsList.innerHTML = `
                <div class="text-center py-4">
                    <i class="bi bi-inbox display-4 text-muted"></i>
                    <div class="mt-3 text-muted">
                        <h6>暂无账号数据</h6>
                        <p class="small mb-0">请通过"数据导入"功能添加邮箱账号</p>
                    </div>
                </div>
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
                <div class="account-item">
                    <div class="d-flex justify-content-between align-items-start">
                        <div class="flex-grow-1">
                            <h6 class="mb-1">
                                <i class="bi bi-envelope me-2"></i>${account.email}
                            </h6>
                            <div class="small text-muted mb-2">
                                <span class="me-3">
                                    <i class="bi bi-calendar3 me-1"></i>
                                    添加时间: ${new Date().toLocaleDateString()}
                                </span>
                                <span class="badge bg-success">
                                    <i class="bi bi-check-circle me-1"></i>已配置
                                </span>
                            </div>
                            <div class="mb-2">
                                <small class="text-muted me-2">标签:</small>
                                ${tagsHtml}
                            </div>
                        </div>
                        <div class="d-flex flex-column gap-1">
                            <div class="btn-group" role="group">
                                <button class="btn btn-outline-primary btn-sm" 
                                        onclick="adminManager.testAccountWithDialog('${account.email}')"
                                        title="测试邮件连接">
                                    <i class="bi bi-play-circle me-1"></i>测试
                                </button>
                                <button class="btn btn-outline-info btn-sm" 
                                        onclick="adminManager.showTagManagementDialog('${account.email}')"
                                        title="管理标签">
                                    <i class="bi bi-tags me-1"></i>标签
                                </button>
                            </div>
                            <button class="btn btn-outline-danger btn-sm" 
                                    onclick="adminManager.deleteAccount('${account.email}')"
                                    title="删除账户">
                                <i class="bi bi-trash me-1"></i>删除
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        accountsList.innerHTML = accountsHtml;
    }

    async testAccountWithDialog(email) {
        // 显示测试邮件对话框
        const modal = new bootstrap.Modal(document.getElementById('testEmailResultModal'));
        const modalTitle = document.getElementById('testEmailResultModalTitle');
        const modalBody = document.getElementById('testEmailResultModalBody');
        
        modalTitle.textContent = `测试邮件连接 - ${email}`;
        modalBody.innerHTML = `
            <div class="text-center py-3">
                <div class="spinner-border text-primary" role="status"></div>
                <div class="mt-2">正在测试邮件连接...</div>
            </div>
        `;
        
        modal.show();
        
        try {
            const response = await fetch('/api/test-email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ email: email })
            });

            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    if (result.data) {
                        // 有邮件数据，显示最新邮件内容
                        const emailData = result.data;
                        const sender = emailData.sender?.emailAddress || emailData.from?.emailAddress || {};
                        const senderName = sender.name || sender.address || '未知发件人';
                        const subject = emailData.subject || '(无主题)';
                        const date = this.formatDate(emailData.receivedDateTime);
                        
                        modalBody.innerHTML = `
                            <div class="alert alert-success">
                                <i class="bi bi-check-circle me-2"></i>
                                <strong>测试成功！</strong> 成功获取到最新邮件
                            </div>
                            <div class="card">
                                <div class="card-header">
                                    <h6 class="mb-0">最新邮件信息</h6>
                                </div>
                                <div class="card-body">
                                    <div class="row">
                                        <div class="col-sm-3"><strong>发件人:</strong></div>
                                        <div class="col-sm-9">${this.escapeHtml(senderName)}</div>
                                    </div>
                                    <div class="row mt-2">
                                        <div class="col-sm-3"><strong>主题:</strong></div>
                                        <div class="col-sm-9">${this.escapeHtml(subject)}</div>
                                    </div>
                                    <div class="row mt-2">
                                        <div class="col-sm-3"><strong>时间:</strong></div>
                                        <div class="col-sm-9">${date}</div>
                                    </div>
                                </div>
                            </div>
                        `;
                    } else {
                        // 无邮件数据
                        modalBody.innerHTML = `
                            <div class="alert alert-info">
                                <i class="bi bi-info-circle me-2"></i>
                                <strong>测试成功！</strong> 连接正常，但该邮箱暂无邮件
                            </div>
                        `;
                    }
                } else {
                    modalBody.innerHTML = `
                        <div class="alert alert-danger">
                            <i class="bi bi-exclamation-triangle me-2"></i>
                            <strong>测试失败：</strong> ${result.message}
                        </div>
                    `;
                }
            } else {
                modalBody.innerHTML = `
                    <div class="alert alert-danger">
                        <i class="bi bi-exclamation-triangle me-2"></i>
                        <strong>测试失败：</strong> HTTP ${response.status}
                    </div>
                `;
            }
        } catch (error) {
            console.error('测试邮件失败:', error);
            modalBody.innerHTML = `
                <div class="alert alert-danger">
                    <i class="bi bi-exclamation-triangle me-2"></i>
                    <strong>测试失败：</strong> ${error.message}
                </div>
            `;
        }
    }

    async deleteAccount(email) {
        if (!confirm(`确定要删除账号 ${email} 吗？此操作不可撤销。`)) {
            return;
        }

        try {
            const response = await fetch('/api/admin/accounts', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ email: email })
            });

            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.showSuccess(`账号 ${email} 删除成功`);
                    this.loadAccounts(); // 刷新列表
                } else {
                    this.showError(`删除失败: ${result.message}`);
                }
            } else {
                this.showError(`删除失败: HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('删除账号失败:', error);
            this.showError(`删除失败: ${error.message}`);
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
            const response = await fetch('/api/admin/export', {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

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
                this.showSuccess('数据导出成功，包含完整配置信息');
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
    
    // ==================== 系统配置功能 ====================
    
    async loadSystemConfig() {
        const currentConfigDisplay = document.getElementById('currentConfigDisplay');
        const emailLimitInput = document.getElementById('emailLimitInput');
        
        currentConfigDisplay.innerHTML = `
            <div class="text-center py-3">
                <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
                <div class="mt-2 small">加载配置中...</div>
            </div>
        `;
        
        try {
            const response = await fetch('/api/system/config');
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    const config = result.data;
                    emailLimitInput.value = config.email_limit || 5;
                    
                    currentConfigDisplay.innerHTML = `
                        <div class="row">
                            <div class="col-md-6">
                                <div class="d-flex justify-content-between">
                                    <span>邮件获取限制:</span>
                                    <strong>${config.email_limit || 5} 条</strong>
                                </div>
                            </div>
                        </div>
                        <div class="mt-2 small text-muted">
                            <i class="bi bi-info-circle me-1"></i>
                            配置更新时间: ${new Date().toLocaleString()}
                        </div>
                    `;
                } else {
                    throw new Error(result.message);
                }
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('加载系统配置失败:', error);
            currentConfigDisplay.innerHTML = `
                <div class="text-center py-3 text-danger">
                    <i class="bi bi-exclamation-triangle"></i>
                    <div class="mt-2 small">加载失败: ${error.message}</div>
                </div>
            `;
        }
    }
    
    async saveSystemConfig() {
        const emailLimitInput = document.getElementById('emailLimitInput');
        const emailLimit = parseInt(emailLimitInput.value);
        
        if (isNaN(emailLimit) || emailLimit < 1 || emailLimit > 50) {
            this.showError('邮件限制必须是1-50之间的数字');
            return;
        }
        
        try {
            const response = await fetch('/api/system/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email_limit: emailLimit })
            });
            
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.showSuccess('系统配置保存成功');
                    this.loadSystemConfig(); // 刷新显示
                } else {
                    this.showError('保存失败: ' + result.message);
                }
            } else {
                this.showError(`保存失败: HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('保存系统配置失败:', error);
            this.showError('保存系统配置失败: ' + error.message);
        }
    }
    
    resetSystemConfig() {
        document.getElementById('emailLimitInput').value = 5;
        this.showSuccess('已重置为默认配置');
    }
    
    // ==================== 测试邮件功能 ====================
    
    async showTestEmailModal() {
        const testEmailInput = document.getElementById('testEmailInput');
        
        // 加载账户列表
        try {
            const response = await fetch('/api/accounts');
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    testEmailInput.innerHTML = '<option value="">请选择要测试的邮箱...</option>';
                    result.data.forEach(account => {
                        const option = document.createElement('option');
                        option.value = account.email;
                        option.textContent = account.email;
                        testEmailInput.appendChild(option);
                    });
                }
            }
        } catch (error) {
            console.error('加载账户列表失败:', error);
        }
        
        // 显示模态框
        const modal = new bootstrap.Modal(document.getElementById('testEmailModal'));
        modal.show();
    }
    
    async executeEmailTest(event) {
        event.preventDefault();
        
        const testEmailInput = document.getElementById('testEmailInput');
        const testEmailResult = document.getElementById('testEmailResult');
        const testEmailContent = document.getElementById('testEmailContent');
        
        const selectedEmail = testEmailInput.value;
        if (!selectedEmail) {
            this.showError('请选择要测试的邮箱');
            return;
        }
        
        // 显示加载状态
        testEmailResult.style.display = 'block';
        testEmailContent.innerHTML = `
            <div class="text-center py-3">
                <div class="spinner-border text-primary" role="status"></div>
                <div class="mt-2">正在测试邮件连接...</div>
            </div>
        `;
        
        try {
            const response = await fetch('/api/test-email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email: selectedEmail })
            });
            
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    if (result.data) {
                        // 有邮件数据
                        const email = result.data;
                        const sender = email.sender?.emailAddress || email.from?.emailAddress || {};
                        const senderName = sender.name || sender.address || '未知发件人';
                        const subject = email.subject || '(无主题)';
                        const date = this.formatDate(email.receivedDateTime);
                        
                        testEmailContent.innerHTML = `
                            <div class="alert alert-success">
                                <i class="bi bi-check-circle me-2"></i>
                                <strong>测试成功！</strong> 成功获取到最新邮件
                            </div>
                            <div class="card">
                                <div class="card-header">
                                    <h6 class="mb-0">最新邮件信息</h6>
                                </div>
                                <div class="card-body">
                                    <div class="row">
                                        <div class="col-sm-3"><strong>发件人:</strong></div>
                                        <div class="col-sm-9">${this.escapeHtml(senderName)}</div>
                                    </div>
                                    <div class="row mt-2">
                                        <div class="col-sm-3"><strong>主题:</strong></div>
                                        <div class="col-sm-9">${this.escapeHtml(subject)}</div>
                                    </div>
                                    <div class="row mt-2">
                                        <div class="col-sm-3"><strong>时间:</strong></div>
                                        <div class="col-sm-9">${date}</div>
                                    </div>
                                </div>
                            </div>
                        `;
                    } else {
                        // 无邮件数据
                        testEmailContent.innerHTML = `
                            <div class="alert alert-info">
                                <i class="bi bi-info-circle me-2"></i>
                                <strong>测试成功！</strong> 连接正常，但该邮箱暂无邮件
                            </div>
                        `;
                    }
                } else {
                    testEmailContent.innerHTML = `
                        <div class="alert alert-danger">
                            <i class="bi bi-exclamation-triangle me-2"></i>
                            <strong>测试失败：</strong> ${result.message}
                        </div>
                    `;
                }
            } else {
                testEmailContent.innerHTML = `
                    <div class="alert alert-danger">
                        <i class="bi bi-exclamation-triangle me-2"></i>
                        <strong>测试失败：</strong> HTTP ${response.status}
                    </div>
                `;
            }
        } catch (error) {
            console.error('测试邮件失败:', error);
            testEmailContent.innerHTML = `
                <div class="alert alert-danger">
                    <i class="bi bi-exclamation-triangle me-2"></i>
                    <strong>测试失败：</strong> ${error.message}
                </div>
            `;
        }
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