# 《Lạc Viên Luân Hồi》AI Text RPG · Hướng Dẫn Nhập Môn (Tiếng Việt)

> Đây là cẩm nang nhập môn đầy đủ dành cho những người chơi **hoàn toàn chưa từng chơi qua**. Bắt đầu từ phần quan trọng nhất - "Cài đặt Giao diện API" - rồi đến phần giải thích chi tiết từng tính năng một. Chỗ nào không hiểu, bạn có thể nhảy thẳng đến chương tương ứng.
>
> Cứ từ từ đọc, không cần nhớ hết trong một lần. Phần thực sự **bắt buộc phải đọc** chỉ có ba chương đầu (cấu hình giao diện → tạo nhân vật → học cách chơi một lượt), các tính năng còn lại thì dùng đến đâu, giở đến chương đó là được.

---

## Mục Lục

**Phần 1 · Bắt Buộc Đọc**
1. [Đây là trò chơi gì](#1-đây-là-trò-chơi-gì)
2. [Bước một: Cấu hình Giao diện AI (quan trọng nhất)](#2-bước-một-cấu-hình-giao-diện-ai-quan-trọng-nhất)
   - 2.1 [Vì sao phải cấu hình giao diện trước](#21-vì-sao-phải-cấu-hình-giao-diện-trước)
   - 2.2 [Thêm giao diện đầu tiên của bạn (Thư Viện API)](#22-thêm-giao-diện-đầu-tiên-của-bạn-thư-viện-api)
   - 2.3 [Kiểm tra kết nối và làm mới danh sách model](#23-kiểm-tra-kết-nối-và-làm-mới-danh-sách-model)
   - 2.4 [Không kết nối được? Cổng proxy và cổng một chạm](#24-không-kết-nối-được-cổng-proxy-và-cổng-một-chạm)
   - 2.5 [**Cách thiết lập Định Tuyến API (Interface Routing)**](#25-cách-thiết-lập-định-tuyến-api-interface-routing)
   - 2.6 [Mỗi tính năng đều có thể gắn giao diện riêng](#26-mỗi-tính-năng-đều-có-thể-gắn-giao-diện-riêng)
3. [Bước hai: Tạo nhân vật, vào game](#3-bước-hai-tạo-nhân-vật-vào-game)
4. [Bước ba: Cách chơi một lượt (vòng lặp cốt lõi)](#4-bước-ba-cách-chơi-một-lượt-vòng-lặp-cốt-lõi)

**Phần 2 · Giải Thích Chi Tiết Tính Năng (dùng đến đâu xem đến đó)**
5. [Nhân vật và trưởng thành](#5-nhân-vật-và-trưởng-thành)
6. [Chế tạo, cường hóa và Cơ Sở Lạc Viên](#6-chế-tạo-cường-hóa-và-cơ-sở-lạc-viên)
7. [Hệ thống chiến đấu](#7-hệ-thống-chiến-đấu)
8. [NPC và giao tiếp xã hội](#8-npc-và-giao-tiếp-xã-hội)
9. [Thế giới và khám phá](#9-thế-giới-và-khám-phá)
10. [Thông tin, ký ức và công cụ trải nghiệm](#10-thông-tin-ký-ức-và-công-cụ-trải-nghiệm)
11. [Trực tuyến và cộng đồng](#11-trực-tuyến-và-cộng-đồng)
12. [Lưu trữ và quản lý dữ liệu](#12-lưu-trữ-và-quản-lý-dữ-liệu)

**Phần 3 · Phụ Lục**
13. [Quy trình khuyến nghị cho người mới & Câu hỏi thường gặp](#13-quy-trình-khuyến-nghị-cho-người-mới--câu-hỏi-thường-gặp)

---

# Phần 1 · Bắt Buộc Đọc

## 1. Đây là trò chơi gì

Đây là một tựa game **nhập vai bằng văn bản (RPG) được vận hành bởi AI**, với chủ đề "**Lạc Viên Luân Hồi · Vô Hạn Lưu**" — bạn là một **Khế Ước Giả** được "Không Gian Chủ Thần" bí ẩn lựa chọn, liên tục bị đưa vào vô số thế giới khác nhau (thế giới nguyên tác, thế giới phim ảnh, thế giới do bạn tự tạo...) để phiêu lưu, trở nên mạnh mẽ hơn, sinh tồn, rồi quay về Không Gian Chủ Thần nghỉ ngơi chỉnh đốn, cứ thế luân hồi.

Điểm khác biệt lớn nhất so với các game thông thường: **nội dung câu chuyện chính được AI viết ra theo thời gian thực**. Bạn không phải bấm nút để kích hoạt cốt truyện cố định, mà **dùng văn bản để mô tả bạn muốn làm gì**, AI đóng vai "đạo diễn + người dẫn chuyện + toàn bộ nhân vật phụ", viết những gì sắp xảy ra thành một đoạn tiểu thuyết cho bạn xem.

**Vòng lặp lối chơi cốt lõi** (chỉ cần nhớ sơ đồ này là đủ):

```
Bạn nhập hành động (muốn làm gì)
        ↓
AI viết ra nội dung câu chuyện của đoạn này (chiến đấu/đối thoại/khám phá……)
        ↓
"Hệ thống tiến hóa" ở hậu trường tự động đọc nội dung, giúp bạn cập nhật dữ liệu
(Thuộc Tính, vật phẩm, kỹ năng, thiện cảm NPC, tiến độ nhiệm vụ, bản đồ…… tất cả đều tự động ghi chép)
        ↓
Bạn xem cốt truyện mới, tiếp tục nhập hành động tiếp theo → Lặp lại
```

Bạn hầu như không cần tự tay điền số liệu. **Bạn chỉ cần "diễn", còn AI và hệ thống lo việc "ghi sổ".** Bạn chém chết một kẻ địch, nhặt được một thanh kiếm, học được một chiêu thức — chỉ cần nội dung chính có viết ra, hệ thống sẽ tự động cho kiếm vào Túi Đồ của bạn, ghi kỹ năng vào người bạn.

**Một số thuật ngữ xuất hiện lặp đi lặp lại, cần làm quen trước:**

| Thuật ngữ | Giải thích dễ hiểu |
|---|---|
| **Khế Ước Giả** | Chính là danh phận của "bạn". Người được Không Gian Chủ Thần lựa chọn, có thể xuyên qua các thế giới. |
| **Không Gian Chủ Thần** | Căn cứ chính / quê nhà của bạn. Nơi nghỉ ngơi, mua sắm, cường hóa trang bị giữa các thế giới (còn gọi là "Lạc Viên Luân Hồi"). |
| **Giai Vị** | Cấp bậc thực lực của bạn (tương tự cảnh giới trong tu tiên). Từ thấp đến cao: nhất giai → nhị giai …… càng lên cao càng mạnh, mỗi giai còn chia thành Lv.1~10. |
| **Thiên Phú** | Tư chất bẩm sinh / năng lực đặc biệt của bạn, xếp hạng D → C → B → A → S → SS → SSS (càng về sau càng bá đạo). |
| **Thuộc Tính (Lục Duy)** | Sức Mạnh / Nhanh Nhẹn / Thể Chất / Trí Lực / Mị Lực / May Mắn. Chỉ số cơ bản của nhân vật, AI sẽ giúp bạn phát triển theo diễn biến cốt truyện. |
| **Xu Lạc Viên / Xu Hồn** | Hai loại tiền tệ. Xu Lạc Viên là tiền tệ thông dụng hàng ngày; Xu Hồn (tiền linh hồn) có giá trị hơn, `1 Xu Hồn ≈ 150.000 Xu Lạc Viên`. |
| **Tiến hóa** | Tên gọi chung cho toàn bộ cơ chế "sau khi viết xong nội dung chính, hậu trường tự động cập nhật dữ liệu". Tiến hóa vật phẩm, tiến hóa NPC… đều thuộc về nó. |

> 💡 **Tóm tắt trong một câu**: Bạn viết hành động → AI viết câu chuyện → Hệ thống tự động cập nhật mọi dữ liệu. Các tính năng còn lại đều xoay quanh vòng lặp này, giúp thế giới phong phú hơn, nhân vật sống động hơn.

---

## 2. Bước một: Cấu hình Giao diện AI (quan trọng nhất)

> ⚠️ **Đây là chương quan trọng nhất trong toàn bộ hướng dẫn. Nếu không cấu hình giao diện, game sẽ không tạo ra được một chữ nào.** Vui lòng đọc hết từ 2.1 đến 2.5.

### 2.1 Vì sao phải cấu hình giao diện trước

Bản thân trò chơi **không tích hợp sẵn AI**. Nó chỉ là một cái "vỏ", có nhiệm vụ đóng gói hành động, thiết lập thế giới, ký ức... của bạn rồi gửi đến **mô hình AI lớn của riêng bạn** để tạo ra câu chuyện. Vì vậy bạn cần cho game biết trước: **"dùng AI nào, kết nối với nó ra sao"**.

Những thứ bạn cần chuẩn bị (chọn 1 trong 3, tùy vào bạn dùng gì):
- Một **API Key (khóa API)** chính thức hoặc trung chuyển của **OpenAI / Google Gemini / Claude / DeepSeek**, v.v.;
- Hoặc bất kỳ trạm trung chuyển / địa chỉ proxy nào **tương thích định dạng OpenAI** + Key;
- Hoặc một model chạy cục bộ (như Ollama / LM Studio, chỉ cần tương thích giao diện OpenAI là được).

> Nếu bạn hoàn toàn chưa có Key: cần tự mình đến nền tảng tương ứng để đăng ký. Hướng dẫn này chỉ nói về **cách điền trong game**, không đề cập đến việc mua Key ở đâu.

### 2.2 Thêm giao diện đầu tiên của bạn (Thư Viện API)

Tất cả giao diện trong game đều được quản lý tập trung tại một nơi gọi là "**Thư Viện API**". Các bước:

1. Bấm vào **⚙ Cài Đặt** ở dưới cùng thanh điều hướng bên phải.
2. Vào **Cài Đặt Chung** (mục lớn đầu tiên).
3. Tìm mục **"Thư Viện API"**, bấm **"+ Thêm giao diện"**.
4. Mở giao diện mới này ra, điền đầy đủ các mục dưới đây:

| Trường | Điền gì | Ví dụ |
|---|---|---|
| **Tên gọi** | Đặt một cái tên bất kỳ mà bạn nhận ra được | `GPT của tôi` / `Gemini chủ lực` |
| **Địa chỉ giao diện** | Địa chỉ gốc API của bạn (thường kết thúc bằng `/v1`) | `https://api.openai.com/v1` |
| **API Key** | Khóa bí mật của bạn | `sk-xxxxxxxx...` |
| **Model ID** | Tên model muốn dùng | `gpt-4o` / `gemini-2.5-pro` / `claude-sonnet-4` |
| **Temperature / Top-P / Max Tokens** | Tham số tạo sinh, người mới cứ dùng mặc định | Temperature 0.7~1.0; Max Tokens khuyến nghị ≥ 4096 |

> 🔑 **Key của bạn chỉ được lưu trong trình duyệt của chính bạn**, không upload lên bất kỳ server nào, cứ yên tâm điền vào.
>
> 📌 **Không biết điền Model ID gì?** Sau khi điền xong địa chỉ và Key, bấm nút **"Làm mới model"** bên cạnh, game sẽ tự động lấy danh sách model khả dụng từ giao diện của bạn, chỉ cần chọn một cái trong danh sách xổ xuống là được.

### 2.3 Kiểm tra kết nối và làm mới danh sách model

Sau khi điền xong, bấm **"🔌 Kiểm tra kết nối"** trong giao diện này:
- Hiện **✅** = kết nối thành công, có thể dùng được.
- Hiện **❌** = có vấn đề, xem thông báo gợi ý (thường gặp: điền sai địa chỉ, Key hết hạn, bị giới hạn khu vực).

**"Làm mới model"**: tự động lấy toàn bộ model khả dụng của giao diện đó, giúp bạn xác nhận Model ID không bị điền sai.

> Đừng quên: giao diện mặc định ở trạng thái "**Đã bật**". Nếu hiện "Đã tắt", bấm vào "Bật". **Giao diện chưa bật / chưa điền địa chỉ / chưa điền Key sẽ không thực sự được gọi.**

### 2.4 Không kết nối được? Cổng proxy và cổng một chạm

Đôi khi bạn sẽ gặp tình huống "**chạy được ở local, nhưng deploy lên online thì báo 403**", hoặc trình duyệt báo lỗi **CORS (cross-origin)**, hoặc trạm trung chuyển của bạn là địa chỉ IP trần dùng `http`. Những vấn đề này có thể giải quyết bằng "**Cổng proxy**":

- Trong khu vực chỉnh sửa giao diện, bấm **"🛡 Qua cổng proxy"**: game sẽ bọc thêm một lớp cho request, chuyển tiếp qua proxy Cloudflare tích hợp sẵn, né tránh các vấn đề cross-origin / khóa IP / HTTPS. Muốn khôi phục lại thì bấm "↩ Hủy proxy".
- Nếu bạn muốn dùng Gemini của **AI Studio** hoặc **Vertex**, bấm **"⚡ Điền nhanh cổng AI Studio / Vertex"** ở cuối Thư Viện API, hệ thống sẽ tự động tạo sẵn hai giao diện đã cấu hình, bạn chỉ cần điền Key AI Studio của mình là được (Vertex cần cấu hình khóa ở phía server, dành cho người chơi nâng cao).
- Còn có một ô tùy chọn "**Địa chỉ cổng cục bộ**": dành cho những người chơi thích tự vọc vạch (chạy một worker trung chuyển trên máy mình, để bên trung chuyển thấy được là IP nhà bạn). Người mới có thể bỏ qua.

### 2.5 Cách thiết lập Định Tuyến API (Interface Routing)

> Đây là **tinh túy** của hệ thống giao diện trong game, cũng là tính năng bạn đặc biệt nên tìm hiểu. Hiểu được nó, bạn có thể khiến game "**một giao diện hỏng thì tự động đổi sang cái tiếp theo, không bao giờ bị gián đoạn**", còn có thể gán các model khác nhau cho các tính năng khác nhau.

**Nó giải quyết vấn đề gì?**
- Bạn có thể có nhiều Key (ví dụ hai trạm trung chuyển GPT + một Gemini), muốn chúng **dùng luân phiên / tự động chuyển khi một cái hỏng** (fallback).
- Bạn có thể muốn **dùng model khác nhau cho từng tính năng**: ví dụ "viết nội dung chính" dùng model đắt và mạnh nhất, "cập nhật dữ liệu vật phẩm" dùng model rẻ và nhanh để tiết kiệm.

**"Định Tuyến API" chính là để làm việc này**: với mỗi tính năng, chỉ định **một chuỗi** giao diện, gọi theo **thứ tự ưu tiên từ trên xuống dưới** mà bạn sắp xếp — giao diện xếp trên cùng được dùng trước, nếu nó thất bại thì tự động chuyển sang cái tiếp theo, thất bại nữa thì chuyển tiếp.

**Cách cấu hình (lấy "Tạo Nội Dung Chính" làm ví dụ):**

1. Trước tiên đảm bảo bạn đã thêm ít nhất một giao diện (tốt nhất là hai ba giao diện) vào "Thư Viện API" theo hướng dẫn ở **2.2**.
2. Vào **Cài Đặt → Tạo Nội Dung Chính**, ở trên cùng sẽ thấy một khung **"⚡ Định Tuyến API"**.
3. Bấm vào menu xổ xuống trong khung **"+ Thêm giao diện vào tuyến…"**, thêm từng giao diện bạn muốn dùng vào.
4. Sau khi thêm vào, mỗi giao diện có mũi tên **↑ ↓** ở bên phải để chỉnh thứ tự (**cái ở trên được gọi trước**), có nút **✕** để xóa bỏ.
5. Sắp xếp xong là được, **tự động có hiệu lực**. Từ giờ tính năng này sẽ: thử giao diện số 1 trước → thất bại thì tự động thử giao diện số 2 → cứ thế tiếp tục.

**Một vài điểm cần lưu ý:**
- **Để trống = quay lại dùng mặc định**: nếu tuyến giao diện của một tính năng nào đó chưa chọn giao diện nào, nó sẽ quay lại dùng "cấu hình riêng / dùng chung API Tạo Nội Dung Chính" ở bên dưới tính năng đó. Vì vậy bạn hoàn toàn có thể không đụng đến Định Tuyến API, chỉ cấu hình một giao diện chính, game vẫn chạy được bình thường — Định Tuyến API là tính năng "nâng cao", không phải "bắt buộc".
- **Chỉ những giao diện "khả dụng" mới có tác dụng**: giao diện trong tuyến phải **đồng thời thỏa mãn** "đã bật + có địa chỉ giao diện + có Key" thì mới thực sự được gọi. Nếu một giao diện nào đó thiếu thứ gì, giao diện sẽ hiển thị chữ đỏ như "Thiếu Key · không có hiệu lực" và nhắc bạn bổ sung.
- **Bản ghi trỏ đến giao diện đã xóa**: nếu bạn xóa một giao diện nào đó trong Thư Viện API, nhưng nó vẫn còn nằm trong một tuyến nào đó, giao diện sẽ nhắc "Có X mục trỏ đến giao diện đã xóa", bấm "Dọn dẹp" là xóa sạch ngay.

> ✅ **Cách cấu hình đỡ mất công nhất dành cho người mới**: thêm 2 giao diện dùng được vào Thư Viện API → trong Định Tuyến API của "Tạo Nội Dung Chính" thêm cả 2 giao diện này vào, xếp cái mạnh nhất lên đầu. Các tính năng khác cứ để mặc kệ (để trống sẽ tự động dùng chung). Như vậy vừa có chủ lực vừa có dự phòng, một cái hỏng sẽ tự động có cái thay thế.

### 2.6 Mỗi tính năng đều có thể gắn giao diện riêng

Trò chơi này tách việc gọi AI thành rất nhiều **tính năng độc lập**, mỗi tính năng đều có thể cấu hình Định Tuyến API riêng (đều nằm ở đầu trang cài đặt tương ứng, cách dùng giống mục 2.5). Bạn **không cần** cấu hình từng cái, phần lớn để trống là được (tự động dùng chung giao diện của Tạo Nội Dung Chính). Liệt kê ra đây chỉ để bạn biết "hóa ra những cái này đều có thể đổi model riêng":

- **Nội dung chính (text)** —— viết câu chuyện chính, quan trọng nhất, khuyến nghị cấu hình model mạnh nhất.
- **Thế giới (world)** —— tạo thiết lập cho thế giới mới / Lạc Viên.
- **Vật phẩm / Nhân vật chính / NPC / Thế Lực / Lãnh Địa / Đội Phiêu Lưu / Vạn Tộc / Linh tinh** —— các giai đoạn "tiến hóa" khác nhau, phụ trách cập nhật dữ liệu. Muốn tiết kiệm thì có thể gắn model rẻ và nhanh cho chúng.
- **Ký ức (memory) / Ký Ức Tự Sự (nm)** —— sắp xếp ký ức cốt truyện dài hạn.
- **Kênh (channel)** —— phát ngôn của các Khế Ước Giả ảo trong kênh công cộng, tin nhắn riêng.
- **Sinh ảnh nội dung chính (image_story_llm)** —— quyết định đoạn nào trong nội dung chính sẽ có ảnh minh họa.

> 💡 Cách chơi tiết kiệm điển hình: **Nội dung chính** gắn model mạnh cỡ Claude / GPT-4; các tiến hóa **Vật phẩm / NPC / Linh tinh** đều gắn model rẻ như `gemini-flash` / `deepseek`. Vừa đảm bảo chất lượng câu chuyện, vừa không phải xót token.

---

## 3. Bước hai: Tạo nhân vật, vào game

Sau khi cấu hình xong giao diện, bạn đã có thể bắt đầu.

**Màn hình bắt đầu (trang bìa)**: một ảnh bìa toàn màn hình, trên đó có ba **vùng bấm trong suốt** (không thấy nút bấm rõ ràng, cứ bấm vào vị trí tương ứng là được):
- **Bắt đầu** —— tạo nhân vật mới, bắt đầu game mới.
- **Tải Bản Lưu** —— nạp bản lưu trước đó.
- **Cài Đặt** —— mở cài đặt (chính là nơi vừa cấu hình giao diện lúc nãy).

**Tạo nhân vật** chia làm hai bước (điền thông tin → xác nhận):

1. **Chọn độ khó** —— độ khó quyết định **tổng số điểm Thuộc Tính ban đầu** của bạn (Dễ 50 điểm, càng khó càng ít, khó nhất "Kẻ vô dụng" chỉ có 10 điểm). Người mới nên chọn **Dễ**.
2. **Chọn Lạc Viên trực thuộc** —— "phe phái / Lạc Viên xuất thân" của bạn, ảnh hưởng đến một số thiết lập danh phận.
3. **Điền thông tin cơ bản** —— tên, tuổi, ngoại hình, câu chuyện nền, v.v. (đều có thể tự tùy chỉnh, AI sẽ tham khảo những thông tin này để viết về bạn).
4. **Phân bổ Thuộc Tính** —— phân bổ điểm Thuộc Tính từ độ khó vào Sức Mạnh/Nhanh Nhẹn/Thể Chất/Trí Lực/Mị Lực/May Mắn (mỗi mục thường ≤ 10, tổng ≤ số điểm của độ khó).
5. **Viết Thiên Phú** —— Thiên Phú khởi đầu của bạn (năng lực bẩm sinh), có trình chỉnh sửa theo định dạng cố định, có thể xem trước theo thời gian thực.
6. (Nâng cao) Còn có thể chọn "**Vật phẩm mang theo khi khởi đầu**" và "**Tùy tùng đi cùng khi khởi đầu**", để AI giúp bạn tạo luôn những thứ này.

Sau khi bấm **Xác nhận**, game sẽ tự động gửi ra **lời mở đầu** —— chính là đoạn nội dung chính đầu tiên của câu chuyện. Nội dung lời mở đầu có thể tự tùy chỉnh trong cài đặt. Sau đó bạn sẽ chính thức bước vào màn hình chính của game.

**Bố cục ba cột của màn hình chính:**
- **Cột trái (cột nhân vật chính)**: ảnh đại diện, tên, Giai Vị, Thuộc Tính, thanh máu HP/EP, trạng thái của bạn. **Bấm vào các trường thông tin có thể chỉnh sửa trực tiếp.**
- **Ở giữa (khu vực nội dung chính)**: câu chuyện hiển thị từng đoạn ở đây. Dưới cùng là **ô nhập liệu**, bạn gõ hành động ở đây.
- **Cột phải (thanh điều hướng)**: một dãy dài biểu tượng tính năng (Trang Bị, Túi Đồ, Kỹ Năng, NPC, Thế Lực……). **Mọi tính năng đều vào từ đây.**

> 📱 Trên điện thoại: cột phải sẽ được thu gọn vào một nút ngăn kéo, bấm mở ra là cùng một thanh điều hướng đó.

---

## 4. Bước ba: Cách chơi một lượt (vòng lặp cốt lõi)

Đây là việc bạn sẽ làm mỗi ngày, học được cái này coi như đã nhập môn.

**① Nhập hành động của bạn.** Trong ô nhập liệu ở dưới cùng khu vực giữa, dùng văn bản mô tả bạn muốn làm gì. Có thể rất đơn giản (`Tôi đẩy cửa bước vào`), cũng có thể rất chi tiết (kèm đối thoại, kèm tâm lý, kèm chiêu thức cụ thể). Viết càng cụ thể, AI diễn càng sát với ý bạn.

**② Gửi đi.** Bấm gửi (hoặc Enter, tùy vào cài đặt). AI bắt đầu "suy nghĩ", sau đó viết ra đoạn câu chuyện này theo kiểu **stream**, từng chữ từng chữ một.

**③ Xem nội dung chính + tự động tiến hóa ở hậu trường.** Sau khi viết xong nội dung chính, "hệ thống tiến hóa" ở hậu trường sẽ tự động đọc đoạn câu chuyện này, cập nhật dữ liệu của bạn: đồ nhặt được vào Túi Đồ, bị thương thì trừ máu, thái độ NPC thay đổi, nhiệm vụ tiến triển…… tất cả đều **tự động**, bạn có thể thấy các thông báo tiến độ như "Đang tiến hóa vật phẩm…", "Đang tiến hóa NPC…" trên thanh trạng thái.

**④ Tiếp tục bước tiếp theo.** Lặp đi lặp lại.

### Các nút hữu ích quanh ô nhập liệu

- **⟳ Tạo lại** —— Không hài lòng với nội dung chính của lượt này? Bấm vào để **viết lại lượt này** (sẽ hủy lượt này trước rồi gửi lại cùng nội dung nhập, dữ liệu sẽ không bị cộng dồn).
- **↩ Quay lại** —— Muốn hủy lượt trước, quay về trạng thái trước khi gửi, bấm vào (sẽ tải lại trang và khôi phục).
- **♻ Tính lại biến (menu Roll lại)** —— Hài lòng với nội dung chính, nhưng **một mục dữ liệu nào đó cập nhật sai / bị thiếu**? Bấm vào để mở menu, có thể **chỉ chạy lại một tiến hóa nhất định** (Vật phẩm, Thuộc Tính nhân vật chính, NPC, Thế Lực, Lãnh Địa, Đội Phiêu Lưu, Vạn Tộc, Nhiệm Vụ, Ký Ức, sinh ảnh……), các dữ liệu khác không đổi. Cũng có thể chọn "Toàn bộ biến" để tính lại tất cả.
  > 🧭 **Quy tắc sắt**: ba công cụ này (Quay lại / Tạo lại / Tính lại biến) phụ thuộc vào "văn bản gốc vừa được tạo ra của lượt này", **tải lại trang hoặc tải bản lưu là sẽ không dùng được nữa** (văn bản gốc chỉ tồn tại trong bộ nhớ). Muốn dùng thì phải dùng sớm.

- **Prompt tiền đặt** —— Phía trên ô nhập liệu có một khung nhỏ có thể mở rộng. Những gì bạn viết ở đây sẽ **được chèn vào phần sâu nhất của câu chuyện ở mỗi lượt**, dùng để ràng buộc AI trong thời gian dài (ví dụ "giữ phong cách u tối", "đừng để nhân vật phụ xoay quanh tôi"). Nó luôn có hiệu lực, không cần gõ lại mỗi lượt.
- **Ngôi kể chuyện** —— một công tắc, chuyển đổi nội dung chính viết về bạn ở ngôi thứ nhất/thứ hai/thứ ba.
- **🎲 Lắc xúc xắc** —— Khi cần "phán định vận mệnh" (ví dụ có cạy được khóa hay không), có thể tự tay lắc xúc xắc, kết quả sẽ được đưa vào cho AI, khiến thành bại có tính ngẫu nhiên và kịch tính hơn.
- **Ba chế độ "thúc đẩy" trước khi vào nội dung chính** (chọn 1 trong 3, loại trừ lẫn nhau, có thể bật trong cài đặt):
  - **Đề Cương Chi Tiết** —— Trước khi tạo nội dung chính, sẽ hiện ra "đề cương cốt truyện của lượt này" để bạn **xem trước, chỉnh sửa, xác nhận**, rồi mới dựa vào đó viết nội dung chính. Rất hữu ích khi bạn muốn kiểm soát hướng đi.
  - **Chỉ Dẫn Cốt Truyện** —— Trước khi tạo nội dung chính, AI sẽ đưa ra một đoạn gợi ý "lượt này nên viết thế nào cho hay hơn" (có thể tìm kiếm trực tuyến thiết lập nguyên tác), giúp mạch truyện hợp lý hơn.
  - **Thúc Đẩy Cơ Sở Dữ Liệu** —— Lớp quy hoạch nâng cao, "gọi lại + thúc đẩy" trước rồi mới viết nội dung chính, tính liền mạch của cốt truyện mạnh hơn.

### Thanh trạng thái trên cùng

Thanh trên cùng sẽ hiển thị **hai mốc thời gian** (thời gian "Lịch Luân Hồi" của Không Gian Chủ Thần + thời gian của thế giới nhiệm vụ hiện tại), **tên thế giới** hiện tại, **thời tiết** (trong thế giới nhiệm vụ còn có hiệu ứng hình ảnh như mưa/tuyết rơi).

### Nhảy nhanh: Bảng Điều Khiển Lệnh

Bấm **⌘K / Ctrl+K** (hoặc bấm biểu tượng 🔍 trên thanh trên cùng) để mở **Bảng Điều Khiển Lệnh**, nhập từ khóa (hỗ trợ bính âm, chữ cái đầu, tên gọi khác) là có thể tìm kiếm mờ, nhảy đến bất kỳ bảng tính năng nào chỉ bằng một cú bấm, không cần tìm trong thanh điều hướng dài dằng dặc. **Rất khuyến khích tạo thói quen sử dụng nó.**

---

# Phần 2 · Giải Thích Chi Tiết Tính Năng

> Dưới đây giới thiệu **từng** tính năng một theo danh mục. Cái nào không dùng đến có thể bỏ qua, cần thì quay lại tra sau. Mỗi tính năng đều ghi rõ **vào từ đâu** (biểu tượng + tên gọi trên thanh điều hướng bên phải).

## 5. Nhân vật và trưởng thành

### Bảng nhân vật chính (hồ sơ danh phận ở cột trái)
Bảng thông tin cốt lõi của bạn, nằm ở **bên trái** màn hình. Bao gồm tên, cấp độ, Giai Vị, Danh Hiệu, nghề nghiệp, danh phận, ID Khế Ước Giả, **Cường Độ Sinh Vật** (như `T3·Chiến Binh`, đo lường sức mạnh bẩm sinh của chủng tộc/huyết mạch), Thuộc Tính, ngoại hình, vị trí, HP/EP. **Bấm vào bất kỳ trường nào để chỉnh sửa.** Các **thuộc tính phái sinh** như tấn công/phòng thủ vật lý được tự động tính từ Thuộc Tính + cấp độ + trang bị, không cần bạn điền.

### ⚔ Trang Bị
Quản lý trang bị bạn **đang mặc trên người**. Mở ra là một bảng ô Trang Bị: vũ khí chính, vũ khí phụ, các bộ phận giáp như đầu/thân trên/thân dưới/tay/chân/vai/eo, trang sức, pháp bảo, v.v. Bấm vào ô để mặc/cởi. Trang Bị sẽ ảnh hưởng theo thời gian thực đến công/thủ và Thuộc Tính của bạn. **`+N`** ở góc trên bên phải thẻ Trang Bị là cấp Cường Hóa (xem mục 6.2).

### 🎒 Túi Đồ (kho chứa)
**Kho chứa** của bạn — tất cả vật phẩm không mặc trên người đều ở đây. Mỗi vật phẩm có màu phẩm chất, hiệu ứng, số lượng, từ tố, điểm đánh giá, v.v. Phía dưới có **thanh tiền tệ** (Xu Lạc Viên / Xu Hồn / Điểm Kỹ Năng / Điểm Kỹ Năng Vàng) và một **bộ đổi tiền tệ** (`1 Xu Hồn = 150.000 Xu Lạc Viên`, đổi được hai chiều). Trong Túi Đồ, bấm "Sử dụng" trên vật phẩm sẽ tự động điền "Sử dụng XX" vào ô nhập liệu chính, tiện cho bạn gửi đi.

> Vật phẩm chia thành các loại như Trang Bị, đồ tiêu hao, nguyên liệu, vật phẩm quan trọng, v.v. Tên gọi, hiệu ứng, giá cả của chúng đều do AI tạo ra dựa theo cốt truyện, và tuân theo một hệ thống "định giá theo màu phẩm chất" (Trắng→Xanh Lá→Xanh Dương→Tím→Vàng Nhạt→Vàng→Vàng Tối→…… càng hiếm càng đắt).

### ✨ Kỹ Năng
Tất cả **Kỹ Năng** bạn biết. Mỗi kỹ năng có: tên gọi, cấp độ (Lv.1→Lv.10→Lv.EX cấp tối đa), loại, **phẩm cấp** (7 bậc: Thường→Tinh Lương→Hiếm→Sử Thi→Truyền Thuyết→Áo Nghĩa→Cực Cảnh), tiêu hao, mục tiêu, hiệu ứng, sát thương, mô tả, v.v. Kỹ Năng phát triển dựa vào **bằng chứng cốt truyện** — trong nội dung chính bạn luyện thành/lĩnh ngộ điều gì, hệ thống sẽ cập nhật điều đó, **không tiêu hao bất kỳ điểm nào**. Cũng có thể chỉnh sửa thủ công.

### 🎖 Danh Hiệu
Bức tường danh hiệu bạn đã **giành được trên suốt hành trình** (như "Kẻ Diệt Rồng", "Nhà Vô Địch Đấu Trường"). Mỗi Danh Hiệu có phẩm cấp, nguồn gốc, hiệu ứng. **Chỉ có thể đeo 1 cái cùng lúc** (cái đang đeo sẽ tạo hiệu ứng cộng thêm và được AI ghi nhớ). Danh Hiệu chỉ tăng không giảm, càng nhiều càng tốt — vinh quang đã giành được sẽ luôn được giữ lại.

### 🏆 Thành Tựu
Tương tự hệ thống Thành Tựu của các game khác (**chỉ nhân vật chính có**). Đạt điều kiện nhất định sẽ mở khóa, có Thành Tựu ẩn (kèm 🔒). Mang tính kỷ niệm thuần túy, không ảnh hưởng đến số liệu.

### 🛠 Nghề Phụ
**Nghề nghiệp đời sống / chế tạo** phi chiến đấu (Luyện Kim, Rèn Đúc, Nấu Ăn…… tên gọi hoàn toàn tự tùy chỉnh). Có hai lớp độ thành thạo: độ thành thạo tổng (Người mới→……→Tông Sư, năm bậc) và tiến độ của từng công thức (0~100). Khi chế tạo đồ, độ thành thạo sẽ tích lũy dần. **Chỉ nhân vật chính mới dùng được.**

### 🌳 Cây Kỹ Năng
Cây Kỹ Năng nghề nghiệp dạng **bản đồ sao xuyên tâm** 🌳. Dùng "Điểm Tiềm Năng" để mở khóa nút, mỗi nút sẽ trao cho bạn một Kỹ Năng hoặc Thiên Phú. Có sẵn mẫu "Kiếm Sĩ" và các mẫu khác, cũng có thể để AI giúp bạn tạo cây mới, còn có thể tự tay cộng điểm, xuất ra chia sẻ (`.tree.json`). **Chỉ nhân vật chính.**

### 🎴 Hệ Thống (khung Trang Bị theo trường phái)
Một bàn cấu hình Trang Bị/Kỹ Năng theo mô hình "**băng ghế dự bị**" 🎴. Bạn có thể lưu các Kỹ Năng, Thiên Phú, Trang Bị khác nhau thành nhiều bộ mẫu "Hệ Thống/trường phái", chuyển đổi tổ hợp thi đấu chỉ bằng một cú bấm (giống như đổi build). Việc chuyển đổi là "không mất mát gì" — cái không ra sân sẽ lùi về băng ghế dự bị, không biến mất. Cũng có thể upload lên Xưởng Sáng Tạo để chia sẻ.

### HP / EP và thanh năng lượng tự tùy chỉnh
- Giới hạn trên của **HP (sinh mệnh) / EP (thể lực/pháp lực)** được **tính từ Thuộc Tính theo hệ số** (mặc định "Thể Chất×20 → HP, Trí Lực×15 → EP", có thể tự tùy chỉnh hệ số trong ma trận 6×2 ở bảng thanh máu). Lượng máu hiện tại **trung thành với nội dung chính**, sẽ không tự động hồi đầy.
- Bạn còn có thể tự tùy chỉnh **tên gọi và giao diện** của thanh máu (ví dụ đổi HP thành "Huyết Trì", EP thành "Linh Lực", đổi sang giao diện thanh máu cuồng nộ).
- **⚡ Thanh năng lượng tự tùy chỉnh**: ngoài HP/EP, tự tạo thêm thanh tài nguyên bổ sung (Nộ Khí / Giá Trị Sa Đọa / Linh Lực……). Nó có thể chỉ để hiển thị theo cốt truyện, cũng có thể bị Kỹ Năng tiêu hao / làm ngưỡng thi triển, thậm chí tích lũy trong chiến đấu. **Chỉ nhân vật chính.**

---

## 6. Chế tạo, cường hóa và Cơ Sở Lạc Viên

### 🎡 Cơ Sở Lạc Viên (cổng vào tổng)
Bấm **🎡 Cơ Sở Lạc Viên** trên thanh điều hướng bên phải, sẽ hiện ra một menu nhỏ, tổng hợp các tính năng và cơ sở giải trí trong Không Gian Chủ Thần: **Cường Hóa Trang Bị, Nâng Cấp KN, Hoan Du Cung (nội dung người lớn, có thể tắt), Đấu Trường, Sòng Bạc**. Dưới đây giới thiệu lần lượt từng cái.

> ⚠️ Các cơ sở như Cường Hóa, Nâng Cấp KN **chỉ dùng được trong Không Gian Chủ Thần (Lạc Viên/phòng riêng)**, sẽ bị làm mờ (không dùng được) trong thế giới nhiệm vụ.

### ⚒ Cường Hóa Trang Bị
Cường hóa Trang Bị từ **+0 lên +16** ⚒. Đây là một lối chơi **thuần front-end, có tính xác định** (không tốn token AI):

- Mỗi cấp có tỷ lệ thành công cố định (+1→+2 là 100%, càng lên cao càng khó, +15→+16 chỉ khoảng 10%).
- **Thất bại sẽ bị phạt**, và chia theo cấp bậc: +0~+2 chắc chắn thành công; +3~+6 thất bại thì giảm 1 cấp; +7~+9 thất bại thì về 0 (trở lại +0); **từ +10 trở lên, thất bại thì Trang Bị sẽ vỡ tan biến mất (nổ đồ)**.
- Có **cơ chế bảo hiểm**: nếu thực sự nổ đồ, sẽ tích lũy "đệm", đệm đủ thì chắc chắn thành công một lần. Có thể dùng đồ rẻ tiền cố tình đi vào vùng nguy hiểm để cày bảo hiểm.
- Có **cô chủ quầy (Kanban Musume)**: các cô chủ quầy khác nhau có mức cộng thêm tỷ lệ thành công, hệ số phí, tính cách khác nhau, còn có **ảnh minh họa theo từng giai đoạn** (càng cường hóa thì ảnh minh họa càng…… bạn hiểu rồi đấy). Bấm vào ảnh minh họa, cô ấy sẽ **buông lời bình luận** dựa theo tình huống thực tế.
- **Làm mới trang bị khi kết thúc**: khi một vòng cường hóa kết thúc, AI sẽ tính lại công/thủ, từ tố, ngoại hình, điểm đánh giá của Trang Bị dựa theo số cấp bạn đã tăng (mỗi 4 cấp +1 từ tố).

### 🔼 Nâng Cấp KN
Tương tự Cường Hóa Trang Bị, nhưng nâng cấp là **Kỹ Năng** 🔼. Dùng "Điểm Kỹ Năng" để nâng cấp Kỹ Năng (mỗi 10 cấp sẽ thêm hiệu ứng mới), dùng "Điểm Kỹ Năng Vàng" để nâng **phẩm cấp** Kỹ Năng (biến đổi về chất). Cũng nằm trong Cơ Sở Lạc Viên.

### 🧰 Xưởng Chế Tạo
Bàn Chế Tạo **dùng được ở mọi thế giới** 🧰. 10 danh mục lớn dựa trên dữ liệu, có rào chắn xác định ở front-end (tung phẩm chất, khóa phẩm cấp, tính ngân sách từ tố) + AI thêm hương vị. Có bách khoa công thức. Dùng khi muốn tự chế Trang Bị/vật phẩm.

### 🎁 Mở Rương
**Dùng được ở mọi thế giới** 🎁. Chọn một rương báu, mở ra vật phẩm tương xứng với phẩm cấp của nó. Lối chơi tương tự Chế Tạo, sau khi khóa mức sản phẩm, AI sẽ quyết định cụ thể mở ra thứ gì.

### 🎰 Sòng Bạc (Sòng Bạc Luân Hồi)
**Trò chơi cờ bạc nhỏ** thuần front-end có tính xác định 🎰: Đoán Tài Xỉu, Vòng Quay, Xì Dách (21 điểm), Thang Nhân Đôi, Đấu Trường Giác Đấu tổng cộng 5 lối chơi, cộng thêm Túi May Mắn (gacha). Đặt cược bằng Xu Lạc Viên hoặc Xu Hồn, có ảnh minh họa người chia bài. Vừa để giải trí, vừa có thể thử vận may.

### 🏟 Đấu Trường
**Bảng xếp hạng phân nhánh theo Giai Vị** 🏟. Chọn một thứ hạng để thách đấu, thắng thì thay thế thứ hạng của đối phương, top 100 có phần thưởng. Dùng lại hệ thống chiến đấu thực để phân định thắng thua, bảng xếp hạng có ghi nhớ. Nhất giai là Đấu Trường thường, từ ngũ giai trở lên có "Đại Chiến Tranh Bá".

### 💗 Hoan Du Cung (nội dung người lớn · mặc định có thể tắt)
Nội dung người lớn 💗. Vào từ Cơ Sở Lạc Viên, chọn cô chủ quầy → vào phòng riêng, có ảnh minh họa theo từng giai đoạn và thao tác nhanh được điều khiển bởi giá trị tình dục. **Nếu ngại thì có thể tắt trực tiếp trong cài đặt**, tắt rồi sẽ không hiển thị trong thanh điều hướng nữa.

---

## 7. Hệ thống chiến đấu

### ⚔️ Chiến Đấu
Bấm **⚔️ Chiến Đấu** trên thanh điều hướng bên phải để phát động một trận **chiến đấu có cấu trúc** (khác với đánh nhau thuần bằng nội dung chính). Sau khi chọn NPC đối thủ sẽ vào bảng Chiến Đấu, dùng cách tính toán front-end kiểu **thẻ bài (tag)** + AI địch cục bộ để đánh trận theo lượt, đánh xong AI sẽ tô điểm thành báo cáo trận đấu. Hỗ trợ các cơ chế như buff/debuff/khiên chắn/hồi chiêu/chiêu lớn tích lực/trận pháp lãnh vực. Kết quả chiến đấu (sát thương, thắng thua) chỉ đi vào dữ liệu, được AI viết thành báo cáo trận đấu hay ho.

> Trong phòng chơi Trực Tuyến, Chiến Đấu do chủ phòng phát động.

### 🎲 Phán định lắc xúc xắc
Không phải bảng riêng biệt, mà là **công cụ bên cạnh ô nhập liệu** (xem Chương 4). Dùng trong các tình huống cần kiểm định may mắn/kỹ năng: tự tay lắc xúc xắc → kết quả cùng với hiệu chỉnh Thuộc Tính/Kỹ Năng/Trang Bị của bạn được đưa vào cho AI → AI dựa vào đó phán định thành bại. Có thể chuyển đổi giữa hai chế độ "công cụ xác định" hoặc "AI làm trọng tài". Kết quả phán định sẽ hiển thị dưới dạng thẻ bài trong hội thoại.

---

## 8. NPC và giao tiếp xã hội

### 📇 NPC
Kho hồ sơ **tất cả nhân vật** bạn từng gặp 📇. Mỗi NPC có dữ liệu chi tiết gồm 11 mục: giới tính, Giai Vị, tính cách, trạng thái, cách xưng hô với bạn, bối cảnh, suy nghĩ nội tâm, mạng lưới quan hệ, thiện cảm, ngoại hình, động cơ, v.v. NPC sẽ **tự động tiến hóa** — dù không ở trước mặt bạn, hậu trường vẫn sẽ thúc đẩy cuộc sống, quan hệ, sự trưởng thành của riêng họ theo đúng danh phận. **Rời khỏi bối cảnh ≠ chết** (nhân vật rời khỏi bối cảnh sẽ được lưu trữ, nhưng khi nội dung chính nhắc đến tên vẫn có thể cứu lại ký ức). NPC đã chết sẽ không hiển thị nữa.

> Trong chi tiết NPC có thể xem/chỉnh sửa Trang Bị, Kỹ Năng, cuộc đời của họ, còn có thể tạo ảnh đại diện cho họ, mở Tin Nhắn Riêng.

### 👥 Bạn Bè
Sau khi thêm NPC làm Bạn Bè 👥, họ sẽ **tham gia tiến hóa NPC mỗi lượt** (quan hệ hoạt động hơn). Có ba nơi để thêm Bạn Bè: bấm ☆ trong bảng NPC, bấm "⭐ Thêm bạn" trong Kênh, bấm "⭐ Thêm bạn" trong Tin Nhắn Riêng. Khi thêm bạn, nếu đối phương chưa có hồ sơ, hệ thống sẽ tự động bổ sung đầy đủ hồ sơ và vật phẩm mang theo của họ.

### ✉ Tin Nhắn Riêng
**Trò chuyện riêng** một-một với từng NPC ✉. Ngoài trò chuyện, còn có thể **giao dịch**: mua / bán / đòi / tặng / đổi đồ, AI sẽ đóng vai đối phương báo giá, mặc cả, việc thành giao dịch được tính toán có tính xác định (đồ vật thực sự sẽ được chuyển giao). Khế Ước Giả, tùy tùng, thú cưng có thể nhắn tin riêng; thổ dân, sinh vật triệu hồi thì không.

### 📡 Kênh (Quảng Trường Khế Ước Giả)
Bảy **Kênh công cộng** 📡, mô phỏng một cộng đồng Khế Ước Giả nhộn nhịp:
- **Trò Chuyện Phiếm** —— AI mô phỏng một loạt Khế Ước Giả ảo đăng bài.
- **Giao Dịch** —— bài đăng bán của người khác bạn có thể mua chỉ bằng một cú bấm; bạn cũng có thể đăng đơn thu mua để AI báo giá, giao dịch có tính xác định.
- **Cửa Hàng Hệ Thống** —— mua bán vật phẩm.
- **Nhân Vật Chính Phát Ngôn** —— bạn tự đăng bài lên tường, các Khế Ước Giả do AI đóng vai sẽ lần lượt phản hồi, bạn có thể "↩ Trả lời" theo hướng chỉ định.
- **Lập Đội Tạm Thời** —— tham gia bài đăng lập đội của người khác, hoặc mời người khác, tạo thành Đội Hình tạm thời.

### 🤝 Đội Hình
**Đội Hình tạm thời** hiện tại của bạn 🤝 (đồng đội lập từ Kênh). Đồng đội là NPC tạm thời, thế giới kết thúc sẽ tự động giải tán, cũng có thể "chuyển chính thức" thành đồng bạn chính thức. Khác với "Đội Phiêu Lưu" (mục 9, đội nhóm cố định của riêng bạn).

---

## 9. Thế giới và khám phá

### 🌍 Chọn Thế Giới / Vào Lạc Viên
Trong cài đặt hoặc lối vào liên quan, có thể **tạo một thế giới mới** để bước vào (AI sẽ đọc Giai Vị của bạn, trung thành với thẻ thiết lập thế giới bạn đưa ra để tạo ra thế giới quan). Sau khi vào, thế giới quan sẽ được chèn vào phần sâu nhất của nội dung chính, bạn sẽ phiêu lưu trong thế giới mới; khi rời đi AI sẽ tổng kết, vào lại thế giới cùng tên có thể chọn "kế thừa" tiến độ trước đó hoặc đặt lại.

### 🗺 Ghi Chép Thế Giới
Ghi lại **biên niên sử các thế giới** bạn đã trải qua 🗺. Thế giới quan của mỗi thế giới, trải nghiệm của bạn trong đó, tổng kết khi rời thế giới đều ở đây.

### 📖 Bách Khoa Thế Giới
**Bách khoa/kho thiết lập** của thế giới bạn đang ở hiện tại 📖, tiện cho bạn tra cứu thông tin về bối cảnh, Thế Lực, quy tắc, v.v. của thế giới này.

### 📚 WIKI Luân Hồi
**Bách khoa thế giới quan** 📚 của chính vũ trụ lớn "Lạc Viên Luân Hồi" (một trang kiến thức độc lập). Giới thiệu các thiết lập như Không Gian Chủ Thần, hệ thống Giai Vị, tiền tệ, thuật ngữ, v.v. **Chống spoil theo kiểu tiệm tiến** — chỉ hiển thị phần bạn đã đọc đến / đã trải qua.

### 🏛 Thế Lực
Hồ sơ **các Thế Lực/tổ chức** khác nhau trong thế giới 🏛 (môn phái, gia tộc, công ty, quốc gia……). Giống như NPC, sẽ tự động tiến hóa: thiện cảm của Thế Lực đối với bạn, mục tiêu, địa bàn sẽ thay đổi theo cốt truyện. Chia thành ba loại "thế giới hiện tại", "không phải thế giới hiện tại", "đã diệt vong". Khi đổi thế giới, Thế Lực cũ sẽ tự động được dọn khỏi thế giới hiện tại.

### 🏯 Lãnh Địa
**Căn cứ cá nhân** của bạn trong Không Gian Chủ Thần 🏯 (được giữ lại xuyên suốt các thế giới, tuyệt đối an toàn). Cấp độ đi theo Giai Vị của bạn, có thể xây dựng đủ loại **công trình hoàn toàn tự tùy chỉnh**, có thanh tiến độ xây dựng và sản lượng bị động (sản lượng sẽ tự động vào kho Lãnh Địa). Bạn có thể sắp xếp NPC vào Lãnh Địa làm thành viên.

### 🛡 Đội Phiêu Lưu
**Đội nhóm cố định do chính bạn thành lập** 🛡 (chỉ có một đội, bạn là đội trưởng). Có cấp độ (E~SSS), kinh nghiệm, hai chỉ số độ hoạt động, thành viên, hiệu ứng đội, thử thách sát hạch. Kinh nghiệm đầy và độ hoạt động đủ sẽ tự động thăng cấp, thăng cấp cao phải qua sát hạch. Chỉ khi nội dung chính có nói rõ "lập đội" thì mới được thành lập. NPC cũng có thể chủ động xin gia nhập đội của bạn.

### 🌌 Vạn Tộc
**Lớp bối cảnh vũ trụ** 🌌 — cục diện Thế Lực lớn "Thất Lạc Viên / Vạn Tộc / Vực Thẳm" trên đầu, sẽ tự xoay chuyển tiến hóa. Thuộc lớp thiết lập bối cảnh làm nổi bật sự hoành tráng của thế giới, tiến hóa độc lập.

### 🕳 Địa Lao Vực Thẳm (Roguelike hệ đọa lạc)
Một lối chơi **Roguelike hệ đọa lạc** 🕳: vào Địa Lao nhiều tầng trong Không Gian Chủ Thần, đoạt lấy "Nguyên Tội Vật", lấy "Giá Trị Ăn Mòn" làm tài nguyên cốt lõi, càng sâu càng nguy hiểm. Có ba tầng build và nhiều trường phái thẻ cộng thêm. Ai thích phong cách Roguelike / đen tối có thể chơi thử.

---

## 10. Thông tin, ký ức và công cụ trải nghiệm

### 🔍 Phân Tích Lượt
**Ảnh chụp dữ liệu rút gọn** của mỗi lượt 🔍: Thuộc Tính/trạng thái/Kỹ Năng/Danh Hiệu của nhân vật chính + thiện cảm/trạng thái/động cơ của toàn bộ NPC + thiện cảm/mục tiêu/địa bàn của Thế Lực…… giữ lại cuộn 14 bản gần nhất. Bảng có thể hiển thị **khác biệt có cấu trúc (diff)** giữa "bản mới nhất so với bản trước đó", giúp bạn nhìn một cái là biết lượt này dữ liệu đã thay đổi gì. So sánh thuần cục bộ, không tốn AI.

### 🧾 Kiểm Toán
Xem kết quả "**đối chiếu sửa lỗi tổng hợp**" 🧾. Sau mỗi lượt nội dung chính, hệ thống sẽ tự động chạy một lần đối chiếu: lấy "dữ liệu thực tế sau khi áp dụng + nội dung chính hai lượt gần nhất" để kiểm tra từng mục, sửa chữa dữ liệu bị bỏ sót/cập nhật sai trong quá trình tiến hóa. Bảng này cho bạn thấy nó đã làm những gì.

### 📋 Nhiệm Vụ
Bảng **Nhiệm Vụ / Đại Sự Thế Giới / Tổng Kết** 📋. Hiển thị nhiệm vụ chính tuyến/nhánh của bạn, các sự kiện lớn xảy ra trong thế giới, tổng kết cốt truyện theo từng đoạn, cùng các thông tin linh tinh cấp thế giới như "hai mốc thời gian".

### 🧠 Ký Ức
**Trung tâm ký ức** cốt truyện dài hạn 🧠. Ở đây thực chất liên quan đến ba cơ chế phối hợp với nhau:
- **Ký Ức Tự Sự** (bật trong cài đặt): dùng từ khóa để gọi lại các đoạn "liên quan" từ cốt truyện lịch sử, chèn vào nội dung chính, giúp AI nhớ những chuyện đã lâu (không cần vector, nhẹ nhàng).
- **Nén tiểu sử**: khi trải nghiệm của mỗi nhân vật tích lũy nhiều, sẽ tự động để AI nén lại thành "sự thật dài hạn", ngăn ngừa việc quên lãng.
- **Gọi lại hồ sơ có cấu trúc** (mặc định bật): mỗi lượt tự động đưa hồ sơ đầy đủ của nhân vật chính + NPC có mặt/liên quan cho AI viết nội dung chính, đảm bảo nó không bị "mất trí nhớ" mà viết sai dữ liệu của bạn.

### Kho Tư Liệu Vector (ký ức ngữ nghĩa)
Phương án ký ức nâng cao (Cài Đặt → Ký ức vector): dùng **vector ngữ nghĩa** để truy xuất ký ức dài hạn, thông minh hơn từ khóa (cần một giao diện embedding). Còn tích hợp sẵn kho vector "tiểu thuyết nguyên tác + world book" — mỗi lượt sẽ chèn đoạn nguyên tác/mục world book theo độ liên quan ngữ nghĩa, giúp cốt truyện sát với nguyên tác hơn. **Sau khi bật sẽ tiếp quản việc gọi lại.**

### 🖼 Sinh Ảnh
Tạo ảnh minh họa cho game 🖼 (Cài Đặt → Cài đặt sinh ảnh). Hỗ trợ nhiều dịch vụ (NAI / OpenAI / Gemini / ComfyUI / tự tùy chỉnh), chia thành ba tuyến độc lập: **chân dung nhân vật, ảnh Trang Bị, minh họa nội dung chính**, có thể chọn dịch vụ và bật/tắt tự động riêng cho từng tuyến. Sau khi bật tự động, khi ngoại hình thay đổi sẽ tự động vẽ lại chân dung, những chỗ quan trọng trong nội dung chính sẽ tự động có minh họa. Ảnh được lưu trong IndexedDB của trình duyệt (không chiếm dung lượng bản lưu).

### 🔊 Giọng Nói (TTS)
Tính năng **đọc to** 🔊. Hỗ trợ Web Speech cục bộ hoặc cổng Edge-TTS (giọng nói neural của Microsoft, miễn phí Key). Có thể gán âm sắc khác nhau cho từng NPC, đọc tách biệt giữa lời dẫn và lời thoại, trong nội dung chính còn có nút 🔊 inline để đọc từng câu.

### 🎨 Làm đẹp giao diện
(Cài Đặt → Làm đẹp giao diện) **Bảo vệ mắt & đổi giao diện** 🎨: 8 bộ giao diện chủ đề, tông màu bảo vệ mắt, hiệu ứng tối góc, phông chữ nội dung chính (bao gồm "Xiaolai Xia Que Kai"), điều chỉnh cỡ chữ và giãn dòng. Xem lâu mỏi mắt thì vào đây chỉnh.

### Đa ngôn ngữ
Game hỗ trợ chuyển đổi **Giản thể / Phồn thể / Tiếng Anh / Tiếng Việt** (trong Cài Đặt). Đây là lớp dịch thời gian thực (runtime), bản thân nội dung chính sẽ không bị dịch.

---

## 11. Trực tuyến và cộng đồng

> Loại này phần lớn cần dịch vụ trực tuyến hỗ trợ, là **phần mở rộng xã hội tùy chọn**. Chơi một mình không đụng đến chúng cũng hoàn toàn OK.

### 🌐 Trực Tuyến
**Lập đội chơi trực tuyến** 🌐: chủ phòng có quyền quyết định + server trung chuyển đồng bộ lượt chơi. Đồng đội tham gia không rào cản (không cần Key riêng), có thể xem Chiến Đấu, điều khiển nhân vật, dùng chung bản lưu trực tuyến.

### 💬 Phòng Chat
Một **Phòng Chat thời gian thực toàn cục độc lập** 💬 (người chơi thật). Có thể chia sẻ thẻ Kỹ Năng/Thiên Phú/Trang Bị/NPC của bạn, hỗ trợ đăng nhập Discord, chấm đỏ tin chưa đọc, ảnh đại diện và giao diện bong bóng chat tự tùy chỉnh.

### 🛒 Sàn Giao Dịch
**Sàn Giao Dịch toàn cục** 🛒: đăng bán đồ, bảng trả giá công khai. Kiểu bảng tin (không tự động khớp lệnh, tránh mất đồ), có cơ chế ký gửi.

### 🏪 Sản Nghiệp
**Sản Nghiệp** bạn có thể kinh doanh 🏪 (Cửa Hàng / Kỹ Viện / Lò Rèn), phục vụ người chơi khác đến tiêu dùng. Có trang cửa hàng riêng, hàng hóa do AI tạo, ảnh minh họa xoay vòng, sổ sách hai loại tiền tệ, sổ thu nhập phía server và banner chờ nhận thưởng.

### 🏰 Công Hội
**Công Hội người chơi không đồng bộ** 🏰 (trước đây gọi là "Gia Tộc"). Tạo/gia nhập Công Hội, danh sách quân hàm, quyên góp đổi phúc lợi, kho Công Hội, biên niên sử, nhiệm vụ hàng tuần, bảng cống hiến, chiến tranh Công Hội, xây dựng căn cứ, v.v. Cấp độ tài khoản, xuyên suốt các bản lưu.

### 🆘 Trợ Chiến
**Sảnh Trợ Chiến** 🆘: upload nhân vật chính hoặc NPC của bạn thành thẻ công khai, người khác có thể mời thẻ của bạn hiện thân thành đồng đội tạm thời của họ (và ngược lại). Có bảng xếp hạng.

### 🏆 Đấu Trường Thế Giới
**Đấu Trường trực tuyến bằng thẻ tham chiến upload lên** 🏆: trọng tài quyền uy phía server (phán định bằng hàm thuần dựa trên chiến lực + seed ngẫu nhiên), tự động chiến đấu, chiếm vị trí thay thế thứ hạng. Mỗi tài khoản có thể đặt 3 thẻ. (Khác với "Đấu Trường" đơn máy trong Cơ Sở Lạc Viên ở mục 6, cái này là **trực tuyến**.)

### ⏱ Thời Gian Chơi
Thống kê **thời gian chơi trực tuyến** của bạn ⏱ và lên bảng xếp hạng (dành cho ai đăng nhập Discord). Front-end đếm nhịp tim tích lũy "thời gian trang hoạt động", server có chống gian lận.

### 🪦 Bia Tưởng Niệm
**Điện Anh Linh xuyên bản lưu** 🪦: khắc ghi nhân vật chính trong quá khứ của bạn thành "thẻ Anh Linh", sau đó có thể triệu hồi vào đội. Xuyên bản lưu, đồng bộ đám mây.

### 🏦 Kho Tài Khoản
**Két sắt xuyên bản lưu** 🏦 (đám mây Discord): cất vật phẩm vào đó, đổi sang bản lưu khác vẫn lấy ra được.
> ⚠️ Khi cất/lấy sẽ mang theo **ảnh chụp vật phẩm đầy đủ**, tránh tình trạng "nhét vào rồi lấy ra thì từ tố biến mất hết".

### 🧩 Xưởng Sáng Tạo
**Trung tâm chia sẻ cộng đồng** 🧩: upload/download 10 loại nội dung được người khác chia sẻ như Cây Kỹ Năng, Hệ Thống, cô chủ quầy, thẻ thế giới, v.v.

---

## 12. Lưu trữ và quản lý dữ liệu

### 💾 Lưu Trữ
**Hệ thống đa bản lưu** 💾 (lưu trong IndexedDB của trình duyệt). Một bản lưu = ảnh chụp đầy đủ toàn bộ dữ liệu + lịch sử hội thoại + hình ảnh của bạn.
- Hỗ trợ **Lưu / Tải Bản Lưu / đổi tên / xóa / xuất / nhập**.
- **Tải Bản Lưu dựa vào tải lại trang** để khôi phục (đây là cơ chế bình thường, đừng hoảng).
- Có **tự động lưu** (sau mỗi lượt, trễ khoảng 20 giây sẽ tự động ghi đè lưu một bản).
- "**Trò Chơi Mới**" sẽ xóa sạch tiến độ nhưng giữ lại cấu hình của bạn (giao diện, preset, v.v.).
- Trong quản lý Lưu Trữ còn có thể **📖 Xuất tiểu thuyết**: làm sạch lịch sử hội thoại của bạn thành file TXT tiểu thuyết chia chương.

### ⚙ Quản Lý Biến (bệ phóng tính năng tiến hóa)
(Cài Đặt → Quản Lý Biến) Đây là "**bệ phóng trung tâm của tất cả tính năng tiến hóa**" 🧬. Vật phẩm, Nhân vật chính, NPC, Thế Lực, Lãnh Địa, Đội Phiêu Lưu, Vạn Tộc, linh tinh, Ký Ức, Sinh Ảnh, Cường Hóa Trang Bị…… công tắc, tần suất, preset, giao diện chuyên dụng của từng hệ thống tiến hóa đều được quản lý phân loại tại đây. **Người mới mặc định không cần đụng vào** — tiến hóa đã sẵn sàng dùng ngay khi mở hộp; đợi khi bạn muốn tinh chỉnh "bao lâu cập nhật NPC một lần", "đổi model rẻ hơn cho tiến hóa vật phẩm" thì hãy vào đây.

### Xuất / Nhập cấu hình toàn cục
Ở khung "**Sao lưu cấu hình · Di chuyển**" dưới cùng trang Quản Lý Biến, có thể **đóng gói xuất ra** toàn bộ cấu hình của bạn chỉ bằng một cú bấm (giao diện, preset, world book, regex, sinh ảnh, vector, mẫu…… **không bao gồm tiến độ game**), khi đổi thiết bị thì nhập vào chỉ bằng một cú bấm. Phù hợp để sao lưu và chuyển đổi thiết bị.

---

# Phần 3 · Phụ Lục

## 13. Quy trình khuyến nghị cho người mới & Câu hỏi thường gặp

### Quy trình làm quen được khuyến nghị

1. **Cấu hình giao diện** (Chương 2): thêm 1~2 giao diện dùng được vào Thư Viện API → kiểm tra ✅ → gắn vào Định Tuyến API của "Tạo Nội Dung Chính".
2. **Tạo nhân vật** (Chương 3): chọn độ khó **Dễ** → phân bổ Thuộc Tính → viết Thiên Phú → xác nhận.
3. **Chơi vài lượt** (Chương 4): nhập hành động tùy ý, làm quen với nhịp điệu "bạn diễn, AI viết, hệ thống ghi sổ". Xem thử dữ liệu cột trái thay đổi thế nào, Túi Đồ có thêm đồ ra sao.
4. **Dạo một vòng các tính năng**: mở 📇NPC, 🎒Túi Đồ, ✨Kỹ Năng, 📋Nhiệm Vụ xem hệ thống đã ghi lại những gì cho bạn.
5. **Muốn cường hóa / giải trí**: về Không Gian Chủ Thần, vào 🎡Cơ Sở Lạc Viên chơi Cường Hóa, Sòng Bạc, Đấu Trường.
6. **Muốn có ảnh / giọng nói**: vào Cài Đặt bật 🖼Sinh Ảnh, 🔊Giọng Nói.
7. Thấy AI "trí nhớ kém" hoặc dữ liệu hay bị sai: vào Cài Đặt bật **🧠Ký Ức Tự Sự**, kiểm tra **🧾Kiểm Toán**, hoặc dùng **♻Tính lại biến** để sửa.

### Câu hỏi thường gặp (FAQ)

**Hỏi: Bấm gửi rồi mà cứ xoay vòng / báo lỗi không tạo ra được?**
Đáp: 99% là do vấn đề giao diện. Quay lại **Cài Đặt → Cài Đặt Chung → Thư Viện API**, bấm "🔌 Kiểm tra kết nối" trên giao diện của bạn xem có ✅ không. Thông báo chữ đỏ sẽ cho bạn biết là sai địa chỉ, Key hết hạn hay bị giới hạn. Cũng nên xác nhận giao diện gắn trong Định Tuyến API của "Tạo Nội Dung Chính" đang ở trạng thái "khả dụng" (đã bật + có địa chỉ + có Key).

**Hỏi: Dữ liệu không cập nhật / cập nhật sai (ví dụ chém chết địch mà máu không trừ, đồ nhặt được không vào Túi Đồ)?**
Đáp: Dùng **♻ Tính lại biến** bên cạnh ô nhập liệu, chọn mục tương ứng (Vật phẩm / Nhân vật chính / NPC…) để chạy lại riêng một lần. Lưu ý tính năng này sẽ mất hiệu lực sau khi tải lại trang, phải dùng ngay trong lượt này. Cũng có thể vào **🧾Kiểm Toán** xem hệ thống đã tự sửa những gì.

**Hỏi: AI quên cốt truyện đã lâu / nhớ sai thiết lập của tôi?**
Đáp: Bật **Cài Đặt → Ký Ức Tự Sự** (gọi lại ký ức dài hạn bằng từ khóa). Muốn mạnh hơn thì bật **Ký ức vector**. Ngoài ra "Gọi lại hồ sơ có cấu trúc" mặc định đã bật sẵn, sẽ đảm bảo AI nhớ dữ liệu **hiện tại** của bạn.

**Hỏi: Tiêu 5000 mà bị ghi nhận thành tiêu 10000, số liệu bị lộn xộn kiểu vậy?**
Đáp: Trò chơi này có cơ chế "tự động thông báo thao tác ngoài cảnh" và "Prompt tiền đặt" để giảm thiểu tình trạng này. Nếu thực sự sai thì dùng ♻ Tính lại biến để sửa, hoặc viết rõ ràng buộc trong **Prompt tiền đặt**.

**Hỏi: Game bị giật / gõ chữ có độ trễ?**
Đáp: Có thể **tắt hiệu ứng thẻ Holographic**, **giảm giới hạn số tầng lịch sử** trong Cài Đặt. Nhiều hình ảnh cũng sẽ làm chậm máy — dùng công cụ dọn dẹp trong Túi Đồ/Cài Đặt để xóa ảnh mồ côi.

**Hỏi: Muốn làm lại từ đầu hoàn toàn?**
Đáp: "Trò Chơi Mới" trong bảng Lưu Trữ sẽ xóa tiến độ nhưng giữ cấu hình. Muốn xóa luôn cả cấu hình, cần xóa bộ nhớ cục bộ (local storage) trong trình duyệt có tiền tố `drpg-` (thao tác nâng cao, cẩn thận khi dùng).

**Hỏi: Đổi máy tính rồi, làm sao mang theo cấu hình và bản lưu?**
Đáp: **Cấu hình** dùng "Xuất/Nhập cấu hình toàn cục" ở cuối trang Quản Lý Biến. **Bản lưu** dùng "Xuất/Nhập" trong bảng Lưu Trữ. (Nếu đăng nhập Discord, Lưu đám mây / Kho Tài Khoản cũng có thể dùng xuyên thiết bị.)

---

> 🎮 **Chúc bạn chơi vui vẻ tại Lạc Viên Luân Hồi!** Hãy nhớ cốt lõi chỉ trong một câu: **bạn phụ trách diễn, AI phụ trách viết, hệ thống phụ trách ghi sổ.** Vài chục tính năng còn lại đều chỉ là gia vị giúp vòng lặp này phong phú hơn — dùng đến cái nào thì giở đến mục đó là được.
