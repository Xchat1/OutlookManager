// 简化版邮件管理器 - 只显示最新一封邮件

class SimpleEmailManager {
    constructor() {
        this.currentEmail = '';
        this.latestEmail = null;
        this.tempAccount = null;
        this.usingTempAccount = false;
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadTempAccount();
    }

    bindEvents() {
        // 邮箱表单提交
        const emailForm = document.getElementById('emailForm');
        emailForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.loadLatestEmail();
        });

        // 刷新按钮
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.loadLatestEmail();
            });
        }

        // 临时账户按钮
        const tempAccountBtn = document.getElementById('tempAccountBtn');
        if (tempAccountBtn) {
            tempAccountBtn.addEventListener('click', () => {
                this.showTempAccountModal();
            });
        }

        // 临时账户表单
        const tempAccountForm = document.getElementById('tempAccountForm');
        if (tempAccountForm) {
            tempAccountForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveTempAccount();
            });
        }

        // 清除临时账户
        const clearTempAccountBtn = document.getElementById('clearTempAccountBtn');
        if (clearTempAccountBtn) {
            clearTempAccountBtn.addEventListener('click', () => {
                this.clearTempAccount();
            });
        }
    }

    async loadLatestEmail() {
        const emailInput = document.getElementById('emailInput');
        const email = emailInput.value.trim();
        
        if (!email) {
            this.showError('请输入邮箱地址');
            return;
        }

        this.currentEmail = email;
        this.showLoading();

        try {
            let apiUrl = `/api/messages?email=${encodeURIComponent(email)}&top=1`;
            let requestOptions = {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            };
            
            // 如果使用临时账户
            if (this.usingTempAccount && this.tempAccount && this.tempAccount.email === email) {
                apiUrl = '/api/temp-messages';
                requestOptions.method = 'POST';
                requestOptions.body = JSON.stringify({
                    email: this.tempAccount.email,
                    password: this.tempAccount.password || '',
                    client_id: this.tempAccount.client_id || '',
                    refresh_token: this.tempAccount.refresh_token,
                    top: 1
                });
            }
            
            const response = await fetch(apiUrl, requestOptions);
            const result = await response.json();
            
            if (result.success && result.data && result.data.length > 0) {
                this.latestEmail = result.data[0];
                this.displayEmail();
                this.showRefreshBtn();
            } else {
                this.showEmpty('该邮箱暂无邮件');
            }
        } catch (error) {
            console.error('Error loading email:', error);
            this.showError('网络错误，请检查连接');
        }
    }

    displayEmail() {
        const emailContent = document.getElementById('emailContent');
        const email = this.latestEmail;
        
        if (!email) {
            this.showEmpty();
            return;
        }

        const sender = email.sender?.emailAddress || email.from?.emailAddress || {};
        const senderName = sender.name || sender.address || '未知发件人';
        const senderAddress = sender.address || '';
        
        const toRecipients = email.toRecipients || [];
        const recipients = toRecipients.map(r => r.emailAddress?.name || r.emailAddress?.address).join(', ') || '未知收件人';
        
        const subject = email.subject || '(无主题)';
        const date = this.formatDate(email.receivedDateTime);
        const body = email.body?.content || '(无内容)';
        const contentType = email.body?.contentType || 'text';
        
        // 检查是否为HTML内容
        const isHtmlContent = contentType === 'html' || 
                              body.includes('<html') || 
                              body.includes('<body') || 
                              body.includes('<div') || 
                              body.includes('<p>');
        
        let bodyHtml = '';
        if (isHtmlContent) {
            bodyHtml = this.sanitizeHtml(body);
        } else {
            bodyHtml = `<pre style="white-space: pre-wrap; font-family: inherit;">${this.escapeHtml(body)}</pre>`;
        }

        emailContent.innerHTML = `
            <div class="email-meta">
                <div class="email-subject">${this.escapeHtml(subject)}</div>
                <div class="email-info">
                    <div class="info-row">
                        <i class="bi bi-person-circle"></i>
                        <span class="info-label">发件人：</span>
                        <span class="info-value">${this.escapeHtml(senderName)}</span>
                        ${senderAddress ? `<span class="badge-custom"><i class="bi bi-envelope-fill"></i>${this.escapeHtml(senderAddress)}</span>` : ''}
                    </div>
                    <div class="info-row">
                        <i class="bi bi-people"></i>
                        <span class="info-label">收件人：</span>
                        <span class="info-value">${this.escapeHtml(recipients)}</span>
                    </div>
                    <div class="info-row">
                        <i class="bi bi-clock"></i>
                        <span class="info-label">时间：</span>
                        <span class="info-value">${date}</span>
                    </div>
                </div>
            </div>
            <div class="email-body">${bodyHtml}</div>
        `;
    }

    showLoading() {
        const emailContent = document.getElementById('emailContent');
        emailContent.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <p style="color: #0078d4; font-weight: 500;">正在加载最新邮件...</p>
            </div>
        `;
    }

    showEmpty(message = '输入邮箱查看最新邮件') {
        const emailContent = document.getElementById('emailContent');
        emailContent.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-envelope"></i>
                <h3>${message}</h3>
                <p>在上方输入邮箱地址，即可查看该邮箱的最新一封邮件</p>
            </div>
        `;
    }


    showRefreshBtn() {
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.style.display = 'inline-flex';
        }
    }

    showError(message) {
        const emailContent = document.getElementById('emailContent');
        emailContent.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-exclamation-triangle" style="color: #f56565;"></i>
                <h3 style="color: #f56565;">错误</h3>
                <p>${this.escapeHtml(message)}</p>
            </div>
        `;
    }

    formatDate(dateString) {
        if (!dateString) return '未知时间';
        
        try {
            const date = new Date(dateString);
            const now = new Date();
            const diffTime = Math.abs(now - date);
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays === 0) {
                return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
            } else if (diffDays === 1) {
                return `昨天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
            } else if (diffDays < 7) {
                return `${diffDays}天前`;
            } else {
                return date.toLocaleString('zh-CN', { 
                    year: 'numeric', 
                    month: '2-digit', 
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }
        } catch (e) {
            return dateString;
        }
    }

    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    sanitizeHtml(html) {
        // 基本的HTML清理，移除潜在危险的标签和属性
        let cleaned = html;
        
        // 移除script标签
        cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        
        // 移除on*事件属性
        cleaned = cleaned.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
        
        // 移除javascript:协议
        cleaned = cleaned.replace(/javascript:/gi, '');
        
        return cleaned;
    }

    // ========== 临时账户管理 ==========
    
    showTempAccountModal() {
        const modal = new bootstrap.Modal(document.getElementById('tempAccountModal'));
        
        // 如果已有临时账户，填充表单
        if (this.tempAccount) {
            document.getElementById('tempEmail').value = this.tempAccount.email || '';
            document.getElementById('tempPassword').value = this.tempAccount.password || '';
            document.getElementById('tempRefreshToken').value = this.tempAccount.refresh_token || '';
        }
        
        modal.show();
    }

    saveTempAccount() {
        const email = document.getElementById('tempEmail').value.trim();
        const password = document.getElementById('tempPassword').value.trim();
        const refreshToken = document.getElementById('tempRefreshToken').value.trim();
        
        if (!email || !refreshToken) {
            alert('邮箱和Refresh Token为必填项');
            return;
        }
        
        this.tempAccount = {
            email: email,
            password: password,
            client_id: '',
            refresh_token: refreshToken
        };
        
        this.usingTempAccount = true;
        
        // 保存到sessionStorage
        sessionStorage.setItem('tempAccount', JSON.stringify(this.tempAccount));
        
        // 关闭模态框
        const modal = bootstrap.Modal.getInstance(document.getElementById('tempAccountModal'));
        modal.hide();
        
        // 自动填充邮箱地址并加载
        document.getElementById('emailInput').value = email;
        this.loadLatestEmail();
    }

    loadTempAccount() {
        const saved = sessionStorage.getItem('tempAccount');
        if (saved) {
            try {
                this.tempAccount = JSON.parse(saved);
                this.usingTempAccount = true;
            } catch (e) {
                console.error('Failed to parse temp account:', e);
            }
        }
    }

    clearTempAccount() {
        this.tempAccount = null;
        this.usingTempAccount = false;
        sessionStorage.removeItem('tempAccount');
        
        // 清空表单
        document.getElementById('tempEmail').value = '';
        document.getElementById('tempPassword').value = '';
        document.getElementById('tempRefreshToken').value = '';
        
        // 关闭模态框
        const modal = bootstrap.Modal.getInstance(document.getElementById('tempAccountModal'));
        if (modal) {
            modal.hide();
        }
        
        alert('临时账户已清除');
    }
}

// 初始化应用
const app = new SimpleEmailManager();

