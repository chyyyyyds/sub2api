package service

import "slices"

// videoProtocolRegistry 保存已实现的上游协议，新增模型时只补充协议规则；
// 时长、比例、分辨率、提示词与素材限制始终读取 GET /models，不在这里硬编码。
var videoProtocolRegistry = map[string]struct {
	Modes         []string
	RequiresImage bool
}{
	"oo-sd25-1080p": {Modes: []string{"reference"}, RequiresImage: false},
}

// VideoModelInitiallyEnabled 初始只接入用户指定模型，初始化不得自动上架其余目录。
func VideoModelInitiallyEnabled(id string) bool { return id == "oo-sd25-1080p" }

// VideoModelIntegrationSupported 供配置初始化复用协议登记，新增模型不必修改初始化流程。
func VideoModelIntegrationSupported(id string) bool { _, ok := videoProtocolRegistry[id]; return ok }

func videoModelEnabled(a *Account, id string) bool {
	if _, ok := videoProtocolRegistry[id]; !ok {
		return false
	}
	if a != nil && a.Extra != nil {
		// 管理配置独立保留扩展入口，但未实现协议的模型不能通过配置绕过。
		if values, ok := a.Extra["video_enabled_models"].([]any); ok {
			for _, value := range values {
				if value == id {
					return true
				}
			}
			return false
		}
		if values, ok := a.Extra["video_enabled_models"].([]string); ok {
			return slices.Contains(values, id)
		}
	}
	return VideoModelInitiallyEnabled(id)
}

func applyVideoProtocol(m *KokoVideoModel) {
	if protocol, ok := videoProtocolRegistry[m.ID]; ok {
		m.Modes = append([]string(nil), protocol.Modes...)
		required := protocol.RequiresImage
		m.RequiresImage = &required
		m.EvidenceSource = "GET /models + KOKO OpenAPI 2026-10-28"
	}
}
