(function($) {
function Board(size) {
    this.size = parseInt(size) || 19;
    this.stones = null;
    this.annotations = null;
    this._events = {};

    this.clearBoard();
    this.clearAnnotations();
}

Board.prototype.addEventListener = function(event_name, callback) {
    var callbacks = this._events[event_name] = this._events[event_name] || [];
    callbacks.push(callback);
}

Board.prototype.dispatchEvent = function(event_name, args) {
    if (this._events.hasOwnProperty(event_name)) {
        var callbacks = this._events[event_name], i;
        for (i = 0; i < callbacks.length; i++) {
            callbacks[i].apply(this, args);
        }
    }
}

Board.prototype.clearAnnotations = function() {
    this.annotations = new Array(this.size);
    for (var i = 0; i < this.stones.length; i++) {
        this.annotations[i] = new Array(this.size);
    }
}

Board.prototype.clearBoard = function() {
    this.stones = new Array(this.size);

    for (var i = 0; i < this.stones.length; i++) {
        this.stones[i] = new Array(this.size);
    }
}

Board.prototype.addStone = function(x, y, color, suppress_change_event) {
    if (x < this.stones.length && y < this.stones.length && !this.stones[x][y]) {
        var stone = new Stone(x, y, this, color);
        this.stones[x][y] = stone;
        stone.mergeGroup();
        stone.killNeighbors();
    }
    if (!suppress_change_event) {
        this.dispatchEvent("change");
    }
}

Board.prototype.serialize = function() {
    var raw_board = {w: [], b: [], size: this.size}, stone, i, j;
    for (i = 0; i < this.stones.length; i++) {
        for (j = 0; j < this.stones.length; j++) {
            stone = this.stones[i][j];
            if (stone) {
                raw_board[stone.color].push({x: i, y: j});
            }
        }
    }
    return JSON.stringify(raw_board);
}

Board.prototype.deserialize = function(raw) {
    if (typeof raw === "string") {
        raw = JSON.parse(raw);
    }

    var board = this;
    board.size = raw.hasOwnProperty("size")? raw.size : 19;
    board.clearBoard();

    if (raw.hasOwnProperty("w")) {
        raw.w.forEach(function(coord) {
            board.addStone(coord.x, coord.y, "w", true);
        });
    }
    if (raw.hasOwnProperty("b")) {
        raw.b.forEach(function(coord) {
            board.addStone(coord.x, coord.y, "b", true);
        });
    }
    this.dispatchEvent("change");
}

function Stone(x, y, board, color) {
    this.x = x;
    this.y = y;
    this.board = board;
    this.color = color;
    this.group = null;
}

Stone.prototype.neighbors = function(action, array_fn) {
    array_fn = array_fn || "map";
    var neighbor_coords = [
        {x: this.x - 1, y: this.y},
        {x: this.x + 1, y: this.y},
        {x: this.x, y: this.y - 1},
        {x: this.x, y: this.y + 1}
    ], board = this.board, stone = this;
    return neighbor_coords.filter(function(coord) {
            return coord.x >= 0 && coord.y >= 0 && coord.x < board.stones.length && coord.y < board.stones.length;
        })[array_fn](function(coord) {
            return action.call(stone, board.stones[coord.x][coord.y]);
        });
}

Stone.prototype.rediscoverGroup = function(new_group) {
    if (!new_group) {
        new_group = new Group();
    }

    if (this.group) {
        this.group.stones = this.group.stones.filter(function(stone) {
            return stone != this;
        });
    }
    this.group = new_group;
    this.group.stones.push(this);

    var reassignNeighbors = function(neighbor) {
        if (neighbor && this.color == neighbor.color && this.group != neighbor.group) {
            neighbor.rediscoverGroup(new_group);
        }
    };
    this.neighbors(reassignNeighbors);
}

Stone.prototype.mergeGroup = function() {
    var merge_neighbor = function(neighbor) {
        if (neighbor && neighbor.color == this.color) {
            var neighbor_group = neighbor.group;
            if (this.group && neighbor_group) {
                neighbor_group.setNewGroup(this.group);
            } else if (neighbor_group) {
                this.group = neighbor_group;
                neighbor_group.stones.push(this);
            } else if (this.group) {
                neighbor.group = this.group;
                this.group.stones.push(neighbor);
            } else {
                neighbor.group = this.group = new Group([this, neighbor]);
            }
        }
    };
    this.neighbors(merge_neighbor);
}

Stone.prototype.killNeighbors = function() {
    var kill_neighbor = function(neighbor) {
        if (neighbor && neighbor.color != this.color) {
            var group = neighbor.group || neighbor;
            if (!group.hasLiberty()) {
                this.board.dispatchEvent("stones_killed", group.die());
            }
        }
    }
    this.neighbors(kill_neighbor);
}

Stone.prototype.hasLiberty = function() {
    var is_neighbor_undefined = function(neighbor) {
        return !neighbor;
    }
    return this.neighbors(is_neighbor_undefined, "some");
}

Stone.prototype.die = function() {
    // FIXME
    this.removeFromBoard();
    return [[this]];
}

Stone.prototype.removeFromBoard = function() {
    this.board.stones[this.x][this.y] = null;
    if (this.group) {
        this.group = null;
        this.neighbors(function(neighbor) {
            if (neighbor && this.color == neighbor.color) {
                neighbor.rediscoverGroup();
            }
        });
    }
}

function Group(stones) {
    if (!stones) {
        stones = []
    }
    this.stones = stones;
    var i;
    for (i = 0; i < stones.length; i++) {
        stones[i].group = this;
    }
}

Group.prototype.setNewGroup = function(group) {
    var i;
    if (this != group) {
        for (i = 0; i < this.stones.length; i++) {
            this.stones[i].group = group;
        }
        group.stones = group.stones.concat(this.stones);
    }
}

Group.prototype.hasLiberty = function() {
    return this.stones.some(function(stone) {
        return stone.hasLiberty();
    });
}

Group.prototype.die = function() {
    this.stones.forEach(function(stone) {
        stone.group = null;
        stone.removeFromBoard();
    });
    return [this.stones];
}
function Record() {
    this.board = new Board();
    this.current_move = null;
    this.root_move = null;
    this.black_player = "";
    this.white_player = "";
    this._static_moves = {w: {}, b: {}};
    this._variation_stack = [];
    this._variation_index = -1;

    // Static position needs to be updated when stones are killed
    var record = this;
    this.board.addEventListener("stones_killed", function(dead_stones) {
        var i, key, w = record._static_moves.w, b = record._static_moves.b;
        if (dead_stones && dead_stones.length) {
            for (i = 0; i < dead_stones.length; i++) {
                for (key in w) {
                    if (key == indeciesToSgfCoord(dead_stones[i])) {
                        delete w[key];
                    }
                }

                for (key in b) {
                    if (key == indeciesToSgfCoord(dead_stones[i])) {
                        delete b[key];
                    }
                }
            }
        }
    });
}

Record.prototype.loadFromSgfString = function(sgf_data) {
    // Parse sgf_data and build move_stack
    var value_re = /\[[^\]]*\]/, cur_mv, last_mv, root_mv, method, cur_char,
        last_method, variation_stack = [], match_index, values, value_prefix;

    this.board.clearBoard();
    while (sgf_data.length > 0) {
        match_index = sgf_data.search(value_re);
        if (match_index >= 0) {
            values = value_re.exec(sgf_data);
            value_prefix = sgf_data.substr(0, match_index).replace(/\s/g, "");
            sgf_data = sgf_data.substr(match_index + values[0].length);

            // Find the current method and handle variations
            method = "";
            while (value_prefix.length > 0) {
                cur_char = value_prefix.charAt(0);
                value_prefix = value_prefix.substr(1);
                if (cur_char === "(") {
                    // Start new variation
                    if (last_mv) {
                        variation_stack.push(cur_mv);
                    }
                } else if (cur_char === ")") {
                    // End the current variation
                    if (variation_stack.length > 0) {
                        cur_mv = variation_stack.pop();
                    }
                } else if (cur_char === ";") {
                    // Start a new move
                    last_mv = cur_mv;
                    cur_mv = new Move();
                    root_mv = root_mv? root_mv : cur_mv;
                    if (last_mv) {
                        last_mv.addNextMove(cur_mv);
                    }
                } else {
                    method += cur_char;
                }
            }
            method = method.trim();
            if (method) {
                last_method = method;
            } else {
                method = last_method;
            }

            // Populate current move
            if (cur_mv) {
                if (cur_mv.meta.indexOf(method) < 0) {
                    cur_mv.meta += " " + method;
                    cur_mv.meta = cur_mv.meta.trim();
                }
                value = values[0].replace(/[\]\[]/g, "");
                if (method == "B" || method == "W") {
                    cur_mv.color = method;
                    cur_mv.position = value;
                } else if (method == "C") {
                    cur_mv.comment = value;
                } else if (method == "AW") {
                    cur_mv.aw.push(value);
                } else if (method == "AB") {
                    cur_mv.ab.push(value);
                } else if (method == "AE") {
                    cur_mv.ae.push(value);
                } else if (method == "LB") {
                    cur_mv.lb.push(value);
                } else if (method == "TR") {
                    cur_mv.tr.push(value);
                } else if (method == "CR") {
                    cur_mv.cr.push(value);
                } else if (method == "SZ") {
                    this.board.size = parseInt(value);
                    this.board.clearBoard()
                } else if (method == "PW") {
                    this.white_player = value;
                } else if (method == "PB") {
                    this.black_player = value;
                }
            }
        } else {
            value_prefix = sgf_data;
            sgf_data = "";
        }
    }
    this._setCurrentMove(root_mv);
    this.root_move = root_mv;

    this._applyStatic();

    this.board.dispatchEvent("change");
}

Record.prototype._applyStatic = function() {
    var move = this.current_move, i, board_coords, stone,
        w = this._static_moves.w, b = this._static_moves.b;

    for (coded_coord in w) {
        board_coords = sgfCoordToIndecies(coded_coord);
        stone = this.board.stones[board_coords[0]][board_coords[1]];
        if (stone) {
            stone.removeFromBoard();
        }
    }
    for (coded_coord in b) {
        board_coords = sgfCoordToIndecies(coded_coord);
        stone = this.board.stones[board_coords[0]][board_coords[1]];
        if (stone) {
            stone.removeFromBoard();
        }
    }

    for (i = 0; i < move.aw.length; i++) {
        coded_coord = move.aw[i];
        delete b[coded_coord];
        w[coded_coord] = true;
    }
    for (i = 0; i < move.ab.length; i++) {
        coded_coord = move.ab[i];
        delete w[coded_coord];
        b[coded_coord] = true;
    }
    for (i = 0; i < move.ae.length; i++) {
        coded_coord = move.ae[i];
        delete b[coded_coord];
        delete w[coded_coord];
    }

    for (coded_coord in w) {
        board_coords = sgfCoordToIndecies(coded_coord);
        this.board.addStone(board_coords[0], board_coords[1], "w", true);
    }
    for (coded_coord in b) {
        board_coords = sgfCoordToIndecies(coded_coord);
        this.board.addStone(board_coords[0], board_coords[1], "b", true);
    }

    this.current_move.raw_static = JSON.stringify(this._static_moves);
}

Record.prototype.setVariationStack = function(new_stack) {
    this._variation_stack = new_stack;
}

Record.prototype.nextMove = function() {
    return this._nextMove(false);
}

Record.prototype._nextMove = function(suppress_change_event) {
    var variation_to_take, board_coords;
    if (this.current_move.next_move) {
        // serialize on the way out if need be
        if (!this.current_move.raw_board) {
            this.current_move.raw_board = this.board.serialize();
        }

        if (!this.current_move.raw_static) {
            this.current_move.raw_static = JSON.stringify(this._static_moves);
        }

        // set next move
        if (Object.prototype.toString.call(this.current_move.next_move) === "[object Array]") {
            this._variation_index++;
            if (!(this._variation_index in this._variation_stack)) {
                this._variation_stack[this._variation_index] = 0;
            }
            variation_to_take = this._variation_stack[this._variation_index];
            this._setCurrentMove(this.current_move.next_move[variation_to_take]);
        } else {
            this._setCurrentMove(this.current_move.next_move);
        }

        // if formerly visited, set board and globals
        if (this.current_move.raw_board) {
            this.board.deserialize(this.current_move.raw_board);
            this._static_moves = JSON.parse(this.current_move.raw_static);
        } else {
            board_coords = sgfCoordToIndecies(this.current_move.position);
            if (board_coords && this.current_move.color) {
                this.board.addStone(board_coords[0], board_coords[1], this.current_move.color.toLowerCase(), suppress_change_event);
            }
            this._applyStatic();

            if (!suppress_change_event) {
                this.board.dispatchEvent("change");
            }

            this.current_move.raw_board = this.board.serialize();
        }
    }
}

Record.prototype.previousMove = function() {
    if (this.current_move.previous_move) {
        this._setCurrentMove(this.current_move.previous_move);
        if (Object.prototype.toString.call(this.current_move.next_move) === "[object Array]") {
            this._variation_index--;
        }
        this.board.deserialize(this.current_move.raw_board);
        this._static_moves = JSON.parse(this.current_move.raw_static);
    }
}

Record.prototype.playMove = function() {}

Record.prototype.jumpToMove = function(move_num) {
    var move_counter = 0;
    this._setCurrentMove(this.root_move);
    this._variation_index = -1;
    this.board.clearBoard();
    while (move_counter < move_num) {
        this._nextMove(true);
        move_counter++;
    }
    this.board.dispatchEvent("change");
}

Record.prototype._setCurrentMove = function(move) {
    this.current_move = move;
    this.board.clearAnnotations();
    var i, board_coords, label;
    for (i = 0; i < move.lb.length; i++) {
        label = move.lb[i].split(":");
        board_coords = sgfCoordToIndecies(label[0]);
        this.board.annotations[board_coords[0]][board_coords[1]] = label[1];
    }
    for (i = 0; i < move.tr.length; i++) {
        board_coords = sgfCoordToIndecies(move.tr[i]);
        this.board.annotations[board_coords[0]][board_coords[1]] = "[tr]";
    }
    for (i = 0; i < move.cr.length; i++) {
        board_coords = sgfCoordToIndecies(move.cr[i]);
        this.board.annotations[board_coords[0]][board_coords[1]] = "[cr]";
    }
}

function Move() {
    this.color = null;
    this.raw_board = null;
    this.raw_static = null;
    this.comment = "";
    this.position = null;
    this.next_move = null;
    this.previous_move = null;
    this.meta = "";
    this.aw = [];
    this.ab = [];
    this.ae = [];
    this.lb = [];
    this.tr = [];
    this.cr = [];
}

Move.prototype.addNextMove = function(mv) {
    if (this.next_move == null) {
        this.next_move = mv;
    } else if (this.next_move instanceof Move) {
        this.next_move = [this.next_move, mv];
    } else {
        this.next_move.push(mv);
    }
    mv.previous_move = this;
}

function sgfCoordToIndecies(sgf_coord) {
    if (sgf_coord) {
        return [sgf_coord.charCodeAt(0) - 97, sgf_coord.charCodeAt(1) - 97];
    } else {
        return [];
    }
}

function indeciesToSgfCoord(xy_obj) {
    if (xy_obj) {
        return String.fromCharCode(xy_obj.x + 97) + String.fromCharCode(xy_obj.y + 97);
    } else {
        return "";
    }
}
function drawBoard(board, canvas) {
    var ctx = canvas.getContext("2d"), dim = 450, margins = 30,
        i, j, dx, dy, x_pos, y_pos, stone, black_stone, stone_radius, padded_stone_radius;

    ctx.clearRect(0,0,500,500);
    ctx.beginPath();

    // Vertical lines
    for (i = 0; i <= board.size - 1; i++) {
        dx = i/(board.size - 1)*dim + margins;
        ctx.moveTo(dx, margins);
        ctx.lineTo(dx, dim + margins);
    }

    // Horizontal lines
    for (i = 0; i <= (board.size - 1); i++) {
        dy = i/(board.size - 1)*dim + margins;
        ctx.moveTo(margins, dy);
        ctx.lineTo(dim + margins, dy);
    }

    // Star points
    if (board.size == 19) {
        ctx.fillStyle = "rgb(0,0,0)";
        for (i = 3; i <= 15; i++) {
            for (j = 3; j <= 15; j++) {
                if (i % 6 == 3 && j % 6 == 3) {
                    dx = i/(board.size - 1)*dim + margins;
                    dy = j/(board.size - 1)*dim + margins;
                    ctx.fillRect(dx - 3, dy - 3, 6, 6);
                }
            }
        }
    }

    ctx.strokeStyle = "rgb(0,0,0)";
    ctx.lineWidth = 1.0;
    ctx.stroke();
    ctx.closePath();

    for (i = 0; i < board.stones.length; i++) {
        for (j = 0; j < board.stones[i].length; j++) {
            stone = board.stones[i][j];
            annotation = board.annotations[i][j];

            x_pos = i / (board.size - 1) * dim + margins;
            y_pos = j / (board.size - 1) * dim + margins;
            stone_radius = dim / ((board.size - 1) * 3);

            if (stone) {
                ctx.beginPath();
                ctx.arc(x_pos, y_pos, stone_radius, 0, 2 * Math.PI);
                ctx.strokeStyle = "rgb(0,0,0)";
                ctx.stroke();
                if (stone.color == "b") {
                    ctx.fillStyle = "rgb(0,0,0)";
                } else {
                    ctx.fillStyle = "rgb(255,255,255)";
                }
                ctx.fill();
                ctx.closePath();
            }

            black_stone = stone && stone.color == "b";
            if (annotation) {
                padded_stone_radius = stone_radius - 1;
                if (annotation == "[tr]") {
                    ctx.beginPath();
                    ctx.moveTo(x_pos, y_pos - padded_stone_radius);
                    ctx.lineTo(x_pos + padded_stone_radius * Math.sqrt(3) / 2, y_pos + padded_stone_radius/2);
                    ctx.lineTo(x_pos - padded_stone_radius * Math.sqrt(3) / 2, y_pos + padded_stone_radius/2);
                    ctx.lineTo(x_pos, y_pos - padded_stone_radius);
                    if (black_stone) {
                        ctx.strokeStyle = "rgb(255,255,255)";
                    } else {
                        ctx.strokeStyle = "rgb(0,0,0)";
                    }
                    ctx.stroke();
                    ctx.closePath();
                } else if (annotation == "[cr]") {
                    ctx.beginPath();
                    ctx.arc(x_pos, y_pos, stone_radius/2, 0, 2 * Math.PI);
                    if (black_stone) {
                        ctx.strokeStyle = "rgb(255,255,255)";
                    } else {
                        ctx.strokeStyle = "rgb(0,0,0)";
                    }
                    ctx.stroke();
                    ctx.closePath();
                } else {
                    if (!black_stone) {
                        ctx.beginPath();
                        ctx.arc(x_pos, y_pos, stone_radius - 1, 0, 2 * Math.PI);
                        ctx.strokeStyle = "rgb(255,255,255)";
                        ctx.stroke();
                        ctx.fillStyle = "rgb(255,255,255)";
                        ctx.fill();
                        ctx.closePath();
                    }

                    ctx.beginPath();
                    ctx.font = "normal 12px Verdana";
                    ctx.fillStyle = black_stone?"rgb(255,255,255)":"rgb(0,0,0)";
                    text_metrics = ctx.measureText(annotation);
                    ctx.fillText(annotation, x_pos - text_metrics.width/2, y_pos + 4);
                    ctx.closePath();
                }
            }
        }
    }
}
$.fn.kifu = function(sgf_data_or_url) {
    if (this.length == 0 || !this[0].getContext) {
        return this;
    }

    var record = this.data("kifu_record"), jq_obj = this;
    if (!record) {
        record = new Record();
        record.board.addEventListener("change", function() {
            drawBoard(this, jq_obj[0]);
        });
        if (typeof sgf_data_or_url === "string") {
            if (endsWith(sgf_data_or_url, ".sgf")) {
                // Return the deferred ajax object
                return $.ajax({
                    url: sgf_data_or_url,
                    dataType: 'text',
                    success: function(data) {
                        record.loadFromSgfString(data);
                        jq_obj.data("kifu_record", record);
                    }
                });
            } else {
                record.loadFromSgfString(sgf_data_or_url);
            }
        } else {
            record.loadFromSgfString(this.html());
        }
        drawBoard(record.board, this[0]);
        this.data("kifu_record", record);
    }
    return record;
}

function endsWith(str, suffix) {
    return str.indexOf(suffix, str.length - suffix.length) !== -1;
}
})(jQuery);
